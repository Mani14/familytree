import { AnimatePresence, motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getDisplayName, getFullName } from '../utils/familyUtils';
import { useTheme } from '../hooks/useTheme';
import { dotIcon } from '../utils/mapMarkers';
import { TILE_ATTRIBUTION, TILE_URLS } from '../utils/mapTiles';
import Modal from './Modal';
import '../styles/FamilyMap.css';

const DEFAULT_CENTER = [20.5937, 78.9629]; // India — shown only when nobody has a pinned location yet
const DEFAULT_ZOOM = 4;
const FOUND_ZOOM = 14;
const MAX_RESULTS = 6;
// Below this, a wide/regional view has too many names crowding and
// overlapping each other to be readable — labels only earn their keep once
// zoomed in enough that pins (and their names) have room to breathe.
const MIN_ZOOM_FOR_LABELS = 10;

const GENDER_COLOR_VAR = {
  male: 'var(--color-male)',
  female: 'var(--color-female)',
  other: 'var(--color-other)',
};
const STAGGER_STEP_MS = 25;
const MAX_STAGGER_MS = 500; // caps the drop-in delay so a huge family doesn't take forever to finish appearing

// Fits the map to every pin's bounds once, the first time there are any — a
// ref (not state) so this doesn't re-fit and yank the view on every render,
// only ever right after the panel opens with data to show.
function FitBounds({ points }) {
  const map = useMap();
  const didFit = useRef(false);

  useEffect(() => {
    if (didFit.current || points.length === 0) return;
    didFit.current = true;
    if (points.length === 1) map.setView(points[0], 12);
    else map.fitBounds(points, { padding: [30, 30] });
  }, [map, points]);

  return null;
}

// Reports the current zoom level up to the parent (including after
// programmatic changes like FitBounds/flyTo, not just manual scroll/pinch —
// Leaflet fires zoomend for both) so name labels can be gated on it.
function ZoomTracker({ onZoomChange }) {
  useMapEvents({ zoomend: (e) => onZoomChange(e.target.getZoom()) });
  return null;
}

export default function FamilyMap({ persons, isOpen, onClose, onSelect }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [isOpenResults, setIsOpenResults] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [locatedPersonId, setLocatedPersonId] = useState(null);
  const mapRef = useRef(null);
  const markerRefs = useRef({});
  // Caches each person's icon by (id, pulse) so an unrelated re-render (e.g.
  // typing in the search box) doesn't hand Leaflet a brand-new icon object —
  // that would tear down and recreate the marker's DOM node, replaying its
  // drop-in entrance animation for everyone, not just whoever's actually
  // supposed to change.
  const iconCache = useRef(new Map());

  const peopleWithCoords = useMemo(
    () => Object.values(persons).filter((p) => p.locationLat != null && p.locationLng != null),
    [persons]
  );

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return peopleWithCoords.filter((p) => getDisplayName(p).toLowerCase().includes(term)).slice(0, MAX_RESULTS);
  }, [peopleWithCoords, query]);

  // Resets on every open, not just once — mirrors PersonForm/other panels not
  // carrying stale search text over from the last time this was opened.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setIsOpenResults(false);
      setLocatedPersonId(null);
    }
  }, [isOpen]);

  // Stable per-(person, pulse) icon — see iconCache's own comment above for why.
  const getIcon = (person, index, pulse) => {
    const key = `${person.id}-${pulse}`;
    if (!iconCache.current.has(key)) {
      const color = GENDER_COLOR_VAR[person.gender] || GENDER_COLOR_VAR.other;
      const delayMs = Math.min(index * STAGGER_STEP_MS, MAX_STAGGER_MS);
      iconCache.current.set(key, dotIcon(color, 16, { delayMs, pulse }));
    }
    return iconCache.current.get(key);
  };

  const flyTo = (person) => {
    setQuery('');
    setIsOpenResults(false);
    mapRef.current?.flyTo([person.locationLat, person.locationLng], FOUND_ZOOM);
    // Give the fly animation a beat to start before popping the marker's
    // popup open — opening it at the very first frame reads as instant/jarring
    // rather than "the map found them".
    setTimeout(() => markerRefs.current[person.id]?.openPopup(), 300);
    // Pulses continuously (see the infinite iteration-count in global.css)
    // until a different search replaces it or the map is closed/reopened
    // (see the isOpen-reset effect above) — no auto-clearing timeout.
    setLocatedPersonId(person.id);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Family Map" width="720px" className="family-map-panel">
      <h2>Family Map</h2>
      {peopleWithCoords.length === 0 ? (
        <p className="family-map-empty">
          Nobody has a pinned location yet — add one from a person's profile (Edit → Location) to see them here.
        </p>
      ) : (
        <>
          <div className="family-map-search">
            <Search size={14} className="family-map-search-icon" />
            <input
              type="text"
              placeholder="Find someone on the map…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setIsOpenResults(true); }}
              onFocus={() => setIsOpenResults(true)}
              onBlur={() => setTimeout(() => setIsOpenResults(false), 150)}
            />
            <AnimatePresence>
              {isOpenResults && query.trim() && (
                <motion.ul
                  className="family-map-search-results glass-surface"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                >
                  {matches.length > 0 ? (
                    matches.map((p) => (
                      <li key={p.id}>
                        {/* onMouseDown (not onClick) fires before the input's blur
                            closes the dropdown, same trick SearchBar.jsx uses. */}
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); flyTo(p); }}>
                          {getDisplayName(p)}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="family-map-search-empty">No pinned matches</li>
                  )}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>

          <div className="family-map-canvas">
            <MapContainer ref={mapRef} center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: '480px', width: '100%' }}>
              <TileLayer url={TILE_URLS[theme] || TILE_URLS.light} attribution={TILE_ATTRIBUTION} />
              <FitBounds points={peopleWithCoords.map((p) => [p.locationLat, p.locationLng])} />
              <ZoomTracker onZoomChange={setZoom} />
              {peopleWithCoords.map((p, index) => (
                <Marker
                  key={p.id}
                  ref={(el) => { markerRefs.current[p.id] = el; }}
                  position={[p.locationLat, p.locationLng]}
                  icon={getIcon(p, index, p.id === locatedPersonId)}
                >
                  {zoom >= MIN_ZOOM_FOR_LABELS && (
                    <Tooltip
                      permanent
                      interactive
                      direction="top"
                      offset={[0, -4]}
                      className="family-map-marker-label"
                      eventHandlers={{ click: () => markerRefs.current[p.id]?.openPopup() }}
                    >
                      {getDisplayName(p)}
                    </Tooltip>
                  )}
                  <Popup>
                    <span className="family-map-popup-name">{getFullName(p)}</span>
                    <br />
                    <span className="family-map-popup-location">{p.location}</span>
                    <br />
                    <div className="family-map-popup-actions">
                      <a
                        className="family-map-popup-view family-map-popup-view--secondary"
                        href={`https://www.google.com/maps/search/?api=1&query=${p.locationLat},${p.locationLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open in Maps
                      </a>
                      <button
                        type="button"
                        className="family-map-popup-view family-map-popup-view--primary"
                        onClick={() => {
                          onSelect(p.id);
                          onClose();
                        }}
                      >
                        View Details
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </>
      )}
    </Modal>
  );
}
