import L from 'leaflet';

// CARTO's free raster tiles (no API key) — light_all/dark_all so the map
// matches the app's own theme instead of always showing a plain/light basemap.
export const TILE_URLS = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

// Required by both OpenStreetMap's and CARTO's usage policies.
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Nominatim (OpenStreetMap's free geocoder) — no API key, CORS-enabled for
// browser use. Usage policy asks for restraint (no bulk/heavy automated use),
// which callers respect via debouncing rather than anything enforced here.
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

export async function searchPlaces(query, limit = 5) {
  const res = await fetch(`${NOMINATIM_BASE}/search?format=json&limit=${limit}&q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Location search failed');
  return res.json();
}

export async function reverseGeocode(lat, lng) {
  const res = await fetch(`${NOMINATIM_BASE}/reverse?format=json&lat=${lat}&lon=${lng}`);
  if (!res.ok) throw new Error('Reverse geocoding failed');
  const data = await res.json();
  return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// A plain colored-dot DivIcon instead of Leaflet's default PNG marker — the
// default icon's image assets don't resolve correctly under Vite without extra
// bundler config (a well-known react-leaflet+Vite gotcha: broken/invisible
// markers), and a simple dot lets each pin be colored (e.g. by gender) for free.
// `delayMs` staggers the drop-in entrance (see .map-dot-icon span's animation
// in global.css) across a set of markers appearing at once; `pulse` adds a
// temporary ring, e.g. for whoever a Family Map search just landed on. Baked
// into the icon's own inline style/class rather than passed as React props,
// since a Leaflet divIcon's HTML is static — Leaflet owns this DOM node, not React.
export function dotIcon(color, size = 16, { delayMs = 0, pulse = false } = {}) {
  return L.divIcon({
    className: 'map-dot-icon',
    html: `<span class="${pulse ? 'map-dot-pulse' : ''}" style="width:${size}px;height:${size}px;background:${color};animation-delay:${delayMs}ms"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
