// CARTO's basemaps.cartocdn.com light_all/dark_all tiles used to be free with
// no API key — as of this fix they now silently return HTTP 200 with a
// watermarked "API KEY REQUIRED" placeholder image instead of erroring, so
// the map looked broken without any failed network request to point at it.
// Switched to Esri's free "Canvas" light/dark gray basemaps instead, which
// still need no key and still give us a matching light/dark pair.
export const TILE_URLS = {
  light: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
};

// Required by both OpenStreetMap's (place names come from OSM data via Esri)
// and Esri's usage policies.
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.esri.com">Esri</a>';

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
