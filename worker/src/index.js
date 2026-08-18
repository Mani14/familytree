import { importX509, jwtVerify, decodeProtectedHeader } from 'jose';

const FIREBASE_PROJECT_ID = 'family-tree-3b760';
const FIREBASE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
// Groq's available model lineup changes over time — llama-3.1-8b-instant
// (originally used here) was deprecated from this account's access. Verified
// working against /openai/v1/models before picking this one.
const GROQ_MODEL = 'openai/gpt-oss-20b';

// Only signed-in users of this specific Firebase project should be able to
// spend the shared Groq free-tier quota. This app has no backend of its own
// (Firebase Cloud Functions would need the paid Blaze plan just to make an
// outbound call to a non-Google API, which is what pushed this proxy onto
// Cloudflare Workers instead) — Firebase ID tokens are ordinary signed JWTs,
// so they can be verified here without the (Node-only, non-Workers-
// compatible) firebase-admin SDK, following Firebase's own documented
// from-scratch verification steps: https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
let certsCache = { fetchedAt: 0, certs: null };
const CERTS_TTL_MS = 60 * 60 * 1000; // Google rotates these every few hours at most.

async function getGoogleCert(kid) {
  if (!certsCache.certs || Date.now() - certsCache.fetchedAt > CERTS_TTL_MS) {
    // Bounded like the Groq call below — an unbounded fetch here would let a
    // slow/stalled Google endpoint hang the whole request indefinitely,
    // which the client-side timeout alone wouldn't make obvious the cause of.
    const res = await fetch(FIREBASE_CERTS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Could not fetch Google certs: ${res.status}`);
    certsCache = { fetchedAt: Date.now(), certs: await res.json() };
  }
  const pem = certsCache.certs[kid];
  if (!pem) throw new Error('No matching certificate for this token.');
  return pem;
}

async function verifyFirebaseIdToken(token) {
  const { kid, alg } = decodeProtectedHeader(token);
  if (alg !== 'RS256' || !kid) throw new Error('Unexpected token header.');
  const pem = await getGoogleCert(kid);
  const publicKey = await importX509(pem, 'RS256');
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });
  if (!payload.sub || typeof payload.auth_time !== 'number' || payload.auth_time > Date.now() / 1000) {
    throw new Error('Token failed Firebase-specific claim checks.');
  }
  return payload.sub;
}

// Scope, in plain terms, for the model's own benefit — it only ever
// classifies intent, it never generates the actual answer (that's computed
// locally from the real family data, deterministically, in
// src/utils/naturalQuery.js's resolveAnswer) — so it needs to know exactly
// what the two real intents look like and treat everything else, including
// questions ABOUT the tool itself, as out of scope for a relationship lookup.
const SYSTEM_PROMPT = `You are the question-understanding layer for a family tree app. You do NOT answer questions yourself — you only classify what's being asked into one exact JSON shape, which a separate local system uses to compute the real answer from the actual family tree data (names, genders, birth dates, death dates, parent/child links, marriages — nothing else; no jobs, addresses, or other personal details are stored). Respond with ONLY a single JSON object, no other text, in exactly one of these shapes:

For "how is X related to Y" / "what is X to Y" / "relationship between X and Y" style questions, asking for the relationship between two specific named people:
{"type": "relation-between", "nameA": "<name as written>", "nameB": "<name as written>"}

For "who are X's <relation>" / "list X's <relation>" / "<relation> of X" style questions, asking for every relative of a specific named person matching some category (cousins, children, siblings, uncles, aunts, parents, grandparents, nephews, nieces, grandchildren, etc):
{"type": "relation-list", "name": "<name as written>", "relationWord": "<the relation word, as asked, singular or plural>"}

For a question asking whose birthday is coming up soon/next, or for a list of upcoming birthdays:
{"type": "birthday-next"}

For a question ABOUT this tool itself — what it can do, how to use it, a greeting, or any other question that isn't asking about a specific relationship in the tree (e.g. "what can you do", "help", "hi", "what is this"):
{"type": "meta"}

If the question doesn't fit any of the above:
{"type": "unknown"}

Extract names exactly as written in the question — don't correct spelling, don't guess a full name, don't add titles.`;

function corsHeaders(origin) {
  const allowed = new Set([
    'https://family-tree-3b760.web.app',
    'https://family-tree-3b760.firebaseapp.com',
    'http://localhost:5173',
    'http://localhost:4173',
  ]);
  return {
    'Access-Control-Allow-Origin': allowed.has(origin) ? origin : 'https://family-tree-3b760.web.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405, origin);
    }

    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return json({ error: 'Sign-in required.' }, 401, origin);
    try {
      await verifyFirebaseIdToken(token);
    } catch (err) {
      return json({ error: `Invalid session: ${err.message}` }, 401, origin);
    }

    let question;
    try {
      question = (await request.json())?.question;
    } catch {
      return json({ error: 'Malformed request body.' }, 400, origin);
    }
    if (!question || typeof question !== 'string' || !question.trim()) {
      return json({ error: 'A non-empty question string is required.' }, 400, origin);
    }

    let groqRes;
    try {
      groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          response_format: { type: 'json_object' },
          temperature: 0,
          // gpt-oss-20b emits internal reasoning tokens before the final JSON
          // — 200 max_tokens was too tight and truncated mid-reasoning on some
          // phrasings, leaving Groq's own JSON-mode validator nothing usable
          // (400 json_validate_failed). reasoning_effort keeps that reasoning
          // phase short in the first place, so 500 is comfortable headroom
          // rather than something actually needed every call.
          max_tokens: 500,
          reasoning_effort: 'low',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: question.trim() },
          ],
        }),
        // Bounds how long a stalled/slow Groq response can hold this request
        // open — without it, an unusual hang here surfaces as the whole Ask
        // panel looking frozen on the client, with nothing to show for why.
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      return json({ error: `Could not reach Groq: ${err.message}` }, 502, origin);
    }

    if (!groqRes.ok) {
      const body = await groqRes.text().catch(() => '');
      return json({ error: `Groq API error ${groqRes.status}: ${body.slice(0, 200)}` }, 502, origin);
    }

    const data = await groqRes.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return json({ error: 'Groq returned no content.' }, 502, origin);

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return json({ error: 'Groq response was not valid JSON.' }, 502, origin);
    }

    // Never trust the model's output shape blindly — validate before handing
    // it back to the client, which feeds this straight into resolveAnswer().
    if (parsed?.type === 'relation-between' && typeof parsed.nameA === 'string' && typeof parsed.nameB === 'string') {
      return json({ type: 'relation-between', nameA: parsed.nameA, nameB: parsed.nameB }, 200, origin);
    }
    if (parsed?.type === 'relation-list' && typeof parsed.name === 'string' && typeof parsed.relationWord === 'string') {
      return json({ type: 'relation-list', name: parsed.name, relationWord: parsed.relationWord }, 200, origin);
    }
    if (parsed?.type === 'meta') {
      return json({ type: 'meta' }, 200, origin);
    }
    if (parsed?.type === 'birthday-next') {
      return json({ type: 'birthday-next' }, 200, origin);
    }
    return json({ type: 'unknown' }, 200, origin);
  },
};
