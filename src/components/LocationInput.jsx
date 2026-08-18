import { AnimatePresence, motion } from 'framer-motion';
import { LocateFixed } from 'lucide-react';
import { useRef, useState } from 'react';
import { reverseGeocode, searchPlaces } from '../utils/mapTiles';
import '../styles/LocationInput.css';

const SEARCH_DEBOUNCE_MS = 600;
const MIN_QUERY_LENGTH = 3;
// A single getCurrentPosition call, even with enableHighAccuracy, often returns
// whatever fix (cell/Wi-Fi-based, sometimes off by kilometers) the device has on
// hand the instant GPS starts warming up, rather than waiting for an actual GPS
// lock. Watching for updates and holding out for one under this accuracy (metres,
// per Coordinates.accuracy) — or the best one seen once GPS_MAX_WAIT_MS runs out —
// gives the hardware time to actually acquire satellites.
const GPS_GOOD_ACCURACY_M = 50;
const GPS_MAX_WAIT_MS = 3000;
// A fix worse than this on the very first reading almost always means the
// browser only has approximate (network/Wi-Fi-based) location to work with —
// real GPS, even weak, is rarely this far off. Confirmed cause in practice:
// Android/iOS both let you grant a site "approximate" rather than "precise"
// location, which no amount of enableHighAccuracy or waiting can upgrade —
// worth telling the person immediately rather than making them sit through
// the full GPS_MAX_WAIT_MS wait to find out their fix was never going to improve.
const GPS_COARSE_ACCURACY_M = 500;

// Once a site's location permission is already denied, calling
// getCurrentPosition/watchPosition again won't even show the browser's native
// prompt — there's nothing left to ask, it's already decided — so retrying
// just looks like nothing happened. Spelling out both places that can block it
// (the site's own permission, and the browser app's OS-level permission — two
// separate settings on mobile) up front instead of a generic "denied" message.
const LOCATION_BLOCKED_STEPS = [
  'Tap the site info icon (🔒 or ⓘ) in the address bar → Permissions/Location → Allow.',
  'On phones, the browser app itself also needs OS-level location access — check Settings → Privacy → Location Services (iOS) or Settings → Apps → [Browser] → Permissions (Android).',
];

// One location per person, settable two ways: type-to-search (Nominatim), or
// "Use My Current Location" (browser Geolocation + reverse geocode). Both
// converge on the same onChange({ location, locationLat, locationLng }) shape.
export default function LocationInput({ value, lat, lng, approximate, onChange }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accuracy, setAccuracy] = useState(null);
  const [gpsWaiting, setGpsWaiting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // Seeded from the person's own saved data (persists across reopening the
  // form, unlike a plain one-off session warning) — see PersonDetail.jsx for
  // where this same flag shows up permanently on their profile too.
  const [imprecise, setImprecise] = useState(!!approximate);
  const debounceRef = useRef(null);

  const runSearch = (text) => {
    clearTimeout(debounceRef.current);
    if (text.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError('');
      setBlocked(false);
      setImprecise(false);
      try {
        setResults(await searchPlaces(text.trim()));
      } catch {
        setError('Could not search locations — check your connection.');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleTextChange = (text) => {
    setQuery(text);
    setIsOpen(true);
    setAccuracy(null);
    setImprecise(false);
    // Editing the text after a coordinate was set means it may no longer
    // describe that point — drop the stale coordinates rather than leave a
    // pin at a place the text doesn't match anymore.
    onChange({ location: text, locationLat: null, locationLng: null, locationApproximate: false });
    runSearch(text);
  };

  const selectResult = (result) => {
    setQuery(result.display_name);
    setResults([]);
    setIsOpen(false);
    setAccuracy(null);
    setImprecise(false);
    onChange({
      location: result.display_name,
      locationLat: parseFloat(result.lat),
      locationLng: parseFloat(result.lon),
      locationApproximate: false,
    });
  };

  const applyPoint = async (pickedLat, pickedLng, pickedAccuracy = null) => {
    setLoading(true);
    setError('');
    setBlocked(false);
    // Only a GPS fix worse than the "clearly approximate, not weak GPS"
    // threshold gets flagged — map-click (exact to where you tapped) and
    // search results never pass an accuracy here, so they're never marked
    // approximate. Persisted (see onChange below), not just shown once now.
    const isApproximate = pickedAccuracy != null && pickedAccuracy > GPS_COARSE_ACCURACY_M;
    setImprecise(isApproximate);
    setAccuracy(pickedAccuracy);
    try {
      const text = await reverseGeocode(pickedLat, pickedLng);
      setQuery(text);
      onChange({ location: text, locationLat: pickedLat, locationLng: pickedLng, locationApproximate: isApproximate });
    } catch {
      setError('Got the coordinates, but could not look up an address for them.');
      onChange({ location: query, locationLat: pickedLat, locationLng: pickedLng, locationApproximate: isApproximate });
    } finally {
      setLoading(false);
    }
  };

  const useCurrentLocation = async () => {
    if (!navigator.geolocation) {
      setBlocked(false);
      setError('Geolocation is not supported by this browser.');
      return;
    }

    // Checked up front, before ever calling getCurrentPosition/watchPosition —
    // if it's already denied, calling those again wouldn't show any prompt at
    // all (nothing left to ask), so this is the only chance to tell the person
    // WHY nothing is happening instead of it looking broken. Not every browser
    // implements the Permissions API for geolocation (Safari's support is
    // patchy) — if the query itself fails, fall through to the normal flow
    // below and let the browser's own prompt/error handle it instead.
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' });
      if (status?.state === 'denied') {
        setBlocked(true);
        setError('Location access is blocked for this site.');
        return;
      }
    } catch {
      // Permissions API unavailable/unsupported here — proceed as normal.
    }

    setBlocked(false);
    setImprecise(false);
    setLoading(true);
    setGpsWaiting(true);
    setError('');

    let best = null;
    let watchId = null;
    let timeoutId = null;
    const finish = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timeoutId);
      setGpsWaiting(false);
      if (best) {
        applyPoint(best.coords.latitude, best.coords.longitude, best.coords.accuracy);
      } else {
        setLoading(false);
        setError('Could not get a precise fix — try again outdoors or near a window.');
      }
    };

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        // Good enough to stop waiting — an actual GPS lock, not a fast-but-rough
        // Wi-Fi/cell fix (those typically read back several hundred metres to a
        // few kilometres of accuracy, well outside this threshold).
        if (pos.coords.accuracy <= GPS_GOOD_ACCURACY_M) {
          finish();
          return;
        }
        // Surface this the moment it's clear, rather than waiting out the full
        // GPS_MAX_WAIT_MS — still keeps watching in case a precise fix follows.
        if (pos.coords.accuracy > GPS_COARSE_ACCURACY_M) setImprecise(true);
      },
      (err) => {
        // A denied-permission error is final and immediate — anything else (e.g.
        // a transient timeout on one watch tick) might still resolve via a later
        // update or the best-effort fallback once GPS_MAX_WAIT_MS elapses, so
        // only bail out early for the permission case.
        if (err.code === err.PERMISSION_DENIED) {
          clearTimeout(timeoutId);
          navigator.geolocation.clearWatch(watchId);
          setLoading(false);
          setGpsWaiting(false);
          setBlocked(true);
          setError('Location access was denied.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_MAX_WAIT_MS }
    );
    timeoutId = setTimeout(finish, GPS_MAX_WAIT_MS);
  };

  const hasCoords = lat != null && lng != null;

  return (
    <div className="location-input">
      <div className="location-input-search">
        <input
          type="text"
          value={query}
          onChange={(e) => handleTextChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          placeholder="Search a place…"
        />
        <AnimatePresence>
          {isOpen && results.length > 0 && (
            <motion.ul
              className="location-input-results glass-surface"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            >
              {results.map((r) => (
                <li key={r.place_id}>
                  {/* onMouseDown (not onClick) fires before the input's blur closes
                      the dropdown, same trick SearchBar.jsx uses. */}
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); selectResult(r); }}>
                    {r.display_name}
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      <div className="location-input-actions">
        <button type="button" onClick={useCurrentLocation} disabled={loading}>
          <LocateFixed size={13} /> Use My Current Location
        </button>
      </div>

      {gpsWaiting && <p className="location-input-hint">Getting an accurate GPS fix… (up to {GPS_MAX_WAIT_MS / 1000}s)</p>}
      {imprecise && (
        <div className="location-input-warning">
          <p>This looks like an approximate location, not GPS-precise.</p>
          <p>Go to Settings → Chrome → Location → enable Precise Location, then try again.</p>
        </div>
      )}
      {error && (
        <div className="location-input-error">
          <p>{error}</p>
          {blocked && (
            <ol>
              {LOCATION_BLOCKED_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      )}
      {!gpsWaiting && hasCoords && !error && (
        <p className="location-input-hint">
          Pinned at {lat.toFixed(4)}, {lng.toFixed(4)}
          {accuracy != null ? ` (accurate to ~${Math.round(accuracy)}m)` : ''}
        </p>
      )}
    </div>
  );
}
