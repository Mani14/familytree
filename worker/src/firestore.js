import { importPKCS8, SignJWT } from 'jose';

const FIREBASE_PROJECT_ID = 'family-tree-3b760';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// The birthday-notification cron needs to read Firestore on a schedule, with
// no signed-in user driving the request — the same "no firebase-admin, it's
// Node-only" constraint that made verifyFirebaseIdToken in index.js hand-roll
// RS256 verification applies here too, just for SIGNING a Google service-
// account OAuth2 JWT bearer assertion instead of verifying a Firebase one.
// Reuses `jose` (already a dependency, already proven working in this exact
// Worker) rather than adding a second crypto library or an unmaintained
// third-party Firestore-REST wrapper.
//
// The service account backing GCP_SERVICE_ACCOUNT_JSON is deliberately
// read-only (granted only `roles/datastore.viewer` in GCP IAM — see
// SKILLS.md) — note `datastore.readonly` is NOT a real OAuth scope for
// Firestore (only `.../auth/datastore`, read+write, exists), so read-only
// here is enforced entirely by the service account's IAM role, not by
// anything this code requests.
let tokenCache = { fetchedAt: 0, token: null };
const TOKEN_TTL_MS = 50 * 60 * 1000; // Google tokens last 1h; refresh a bit early.

async function getAccessToken(env) {
  if (tokenCache.token && Date.now() - tokenCache.fetchedAt < TOKEN_TTL_MS) {
    return tokenCache.token;
  }
  const sa = JSON.parse(env.GCP_SERVICE_ACCOUNT_JSON);
  const privateKey = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const { access_token: accessToken } = await res.json();
  tokenCache = { fetchedAt: Date.now(), token: accessToken };
  return accessToken;
}

// Un-wraps the REST API's verbose {stringValue}/{mapValue:{fields}}/etc.
// value format into plain JS — the shape `families/main`'s `persons` map
// (and every `users/{uid}` doc) actually arrives in over this API.
function unwrapValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unwrapValue);
  if ('mapValue' in v) return unwrapFields(v.mapValue.fields || {});
  return undefined;
}

function unwrapFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, unwrapValue(v)]));
}

export async function getDocument(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore getDocument(${path}) failed: ${res.status}`);
  const doc = await res.json();
  return unwrapFields(doc.fields || {});
}

// Loops on nextPageToken defensively — unlikely to matter at this app's
// scale (one family's worth of linked accounts), but never assume one page.
export async function listDocuments(env, collectionPath) {
  const token = await getAccessToken(env);
  const results = [];
  let pageToken;
  do {
    const url = new URL(`${FIRESTORE_BASE}/${collectionPath}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Firestore listDocuments(${collectionPath}) failed: ${res.status}`);
    const body = await res.json();
    for (const doc of body.documents || []) {
      const id = doc.name.split('/').pop();
      results.push({ id, ...unwrapFields(doc.fields || {}) });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return results;
}
