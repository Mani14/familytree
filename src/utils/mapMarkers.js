import L from 'leaflet';

// A plain colored-dot DivIcon instead of Leaflet's default PNG marker — the
// default icon's image assets don't resolve correctly under Vite without extra
// bundler config (a well-known react-leaflet+Vite gotcha: broken/invisible
// markers), and a simple dot lets each pin be colored (e.g. by gender) for free.
// `delayMs` staggers the drop-in entrance (see .map-dot-icon span's animation
// in global.css) across a set of markers appearing at once; `pulse` adds a
// temporary ring, e.g. for whoever a Family Map search just landed on. Baked
// into the icon's own inline style/class rather than passed as React props,
// since a Leaflet divIcon's HTML is static — Leaflet owns this DOM node, not React.
//
// Kept in its own module, separate from mapTiles.js's plain fetch-based
// helpers (searchPlaces/reverseGeocode) — those are also used by
// LocationInput.jsx, which is no longer lazy-loaded, so importing leaflet
// here instead keeps it out of the main bundle for anyone who never opens
// the (lazy-loaded) Family Map.
export function dotIcon(color, size = 16, { delayMs = 0, pulse = false } = {}) {
  return L.divIcon({
    className: 'map-dot-icon',
    html: `<span class="${pulse ? 'map-dot-pulse' : ''}" style="width:${size}px;height:${size}px;background:${color};animation-delay:${delayMs}ms"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
