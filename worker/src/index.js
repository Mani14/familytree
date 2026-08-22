import { importX509, jwtVerify, decodeProtectedHeader } from 'jose';
import { getDocument, listDocuments } from './firestore.js';
import { sendEmail } from './email.js';
import { birthdayPersonEmail, birthdayNotifyEmail } from './emailTemplates.js';

const APP_URL = 'https://familyroots.co.in/';
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
const SYSTEM_PROMPT = `You are the question-understanding layer for a family tree app. You do NOT answer questions yourself — you only classify what's being asked into one exact JSON shape, which a separate local system uses to compute the real answer from the actual family tree data (names, genders, birth dates, death dates, parent/child links, marriages, each person's job/work, and where they live — nothing else). Respond with ONLY a single JSON object, no other text, in exactly one of these shapes:

For "how is X related to Y" / "what is X to Y" / "relationship between X and Y" style questions, asking for the relationship between two specific named people:
{"type": "relation-between", "nameA": "<name as written>", "nameB": "<name as written>"}

For "who are X's <relation>" / "list X's <relation>" / "<relation> of X" style questions, asking for every relative of a specific named person matching some category (cousins, children, siblings, uncles, aunts, parents, grandparents, nephews, nieces, grandchildren, etc):
{"type": "relation-list", "name": "<name as written>", "relationWord": "<the relation word, as asked, singular or plural>"}

For a question asking whose birthday is coming up soon/next, or for a list of upcoming birthdays:
{"type": "birthday-next"}

For questions about a recorded DETAIL of people rather than a specific relationship — their job/work, where they live, their gender, whether they are living or deceased, the year they were born, or their name — OR a COUNT of such people ("how many ..."):
{"type": "attribute-query", "field": "<one of: work, location, gender, status, birthYear, name, any, all>", "value": "<the value asked about, as written; the job, the place, \"male\" or \"female\", \"alive\" or \"deceased\", the 4-digit year, or the name; empty string when field is all>", "aggregate": <true if the question asks "how many" / a count, otherwise false>}
Use field "all" with value "" only for a plain count of everyone (e.g. "how many people are in the tree"). Use field "any" when the question is about people matching a word that could be a job/place/description but you can't tell which (e.g. "who is a teacher", "any engineers") — put that word in value. For gender use value "male" or "female"; for living/deceased use value "alive" or "deceased". Never use any field other than the eight listed — there is no phone or email search.

For a request to ADD or CREATE a NEW person into the tree and attach them to an existing person by a family relationship (e.g. "add Ravi as son of Kumar", "add a daughter named Priya to Meena", "create Kumar's wife Latha"):
{"type": "add-person", "name": "<the NEW person's name, as written>", "relationWord": "<son|daughter|child|father|mother|parent|brother|sister|sibling|husband|wife|spouse>", "target": "<the EXISTING person's name they attach to, as written>"}
Only use this for an explicit add/create request, never for a question.

For a question ABOUT this tool itself — what it can do, how to use it, a greeting, or any other question that isn't asking about a specific relationship in the tree (e.g. "what can you do", "help", "hi", "what is this"):
{"type": "meta"}

If the question doesn't fit any of the above:
{"type": "unknown"}

Extract names exactly as written in the question — don't correct spelling, don't guess a full name, don't add titles.`;

function corsHeaders(origin) {
  const allowed = new Set([
    'https://familyroots.co.in',
    'https://www.familyroots.co.in',
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

// Mirrors getDaysUntilBirthday's "is it today" case from src/utils/familyUtils.js
// — reimplemented standalone rather than imported, since the Worker can't
// pull in that file (it's part of the Vite/React build, not this one) for
// what's a 2-line date comparison. Pure string comparison in UTC (both `dob`
// and "today" as 'MM-DD' slices) sidesteps timezone entirely — Workers run in
// UTC and the cron itself fires on a fixed UTC schedule, so there's no local-
// timezone conversion to get wrong here.
function isBirthdayToday(dob) {
  if (!dob || dob.length < 10) return false; // guards year-only dates (dod supports those; dob shouldn't have any today, but don't crash if one ever does)
  const todayMonthDay = new Date().toISOString().slice(5, 10);
  return dob.slice(5, 10) === todayMonthDay;
}

// Runs once daily via the Cron Trigger in wrangler.toml. Reads Firestore
// directly with a narrowly-scoped (read-only) service-account credential —
// see firestore.js's comment for why that's safe and how it's enforced.
async function runBirthdayJob(env) {
  const familyDoc = await getDocument(env, 'families/main');
  const persons = familyDoc?.persons || {};
  const users = await listDocuments(env, 'users');
  // Every signed-in account with a cached login email gets the broadcast —
  // there's no per-account opt-in. The ONLY control is the admin master
  // switch below, so this reaches every family member who's used the app,
  // not just whoever happened to find and enable a personal toggle.
  const recipients = users.filter((u) => u.email);

  const birthdayPeople = Object.values(persons).filter((p) => p.isAlive && isBirthdayToday(p.dob));
  if (!birthdayPeople.length) return; // nothing to send today — the common case

  for (const person of birthdayPeople) {
    if (!person.verifiedEmail) continue; // only a linked, self-managed account — never the freeform contact `email` field
    try {
      const { subject, html } = birthdayPersonEmail({ firstName: person.firstName, appUrl: APP_URL });
      await sendEmail(env, { to: person.verifiedEmail, subject, html });
    } catch (err) {
      console.error(err);
    }
  }

  // Admin-controlled master switch (Admin Settings > App-Wide Settings) —
  // off by default. Doesn't affect the personal "Happy Birthday" email
  // above, which only ever depends on that one person's own account being
  // linked (verifiedEmail).
  const appSettings = await getDocument(env, 'settings/app');
  if (!appSettings?.features?.birthdayAlertEmails) return;

  for (const user of recipients) {
    for (const person of birthdayPeople) {
      if (user.email === person.verifiedEmail) continue; // don't tell someone it's their own birthday — they already got the personal email above
      try {
        const { subject, html } = birthdayNotifyEmail({ firstName: person.firstName, lastName: person.lastName, appUrl: APP_URL });
        await sendEmail(env, { to: user.email, subject, html });
      } catch (err) {
        console.error(err);
      }
    }
  }
}

// Manually broadcast ONE person's birthday to every signed-in user — the same
// "today is X's birthday" email the daily job sends, but for a single chosen
// person on demand (e.g. the cron ran before this person's alert was wanted).
// Secret-gated in fetch(); ignores the admin master switch since it's an
// explicit, deliberate admin action.
async function broadcastBirthdayForPerson(env, personId) {
  const familyDoc = await getDocument(env, 'families/main');
  const person = familyDoc?.persons?.[personId];
  if (!person) return { error: 'Person not found', personId };
  const users = await listDocuments(env, 'users');
  const recipients = users.filter((u) => u.email);
  let sent = 0;
  for (const user of recipients) {
    if (user.email === person.verifiedEmail) continue; // don't tell someone it's their own birthday
    try {
      const { subject, html } = birthdayNotifyEmail({ firstName: person.firstName, lastName: person.lastName, appUrl: APP_URL });
      await sendEmail(env, { to: user.email, subject, html });
      sent += 1;
    } catch (err) {
      console.error(err);
    }
  }
  return { ok: true, person: `${person.firstName} ${person.lastName || ''}`.trim(), recipients: recipients.length, sent };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Secret-gated manual birthday broadcast (see broadcastBirthdayForPerson) —
    // bypasses the Firebase-auth Ask flow below, authenticated by its own shared
    // secret instead since there's no signed-in user driving it. Used to send one
    // person's "today is X's birthday" email on demand when the daily cron ran
    // before that alert was wanted.
    const triggerSecret = request.headers.get('X-Birthday-Trigger');
    if (triggerSecret) {
      if (!env.BIRTHDAY_TRIGGER_SECRET || triggerSecret !== env.BIRTHDAY_TRIGGER_SECRET) {
        return json({ error: 'Invalid trigger secret.' }, 403, origin);
      }
      let personId;
      try {
        personId = (await request.json())?.personId;
      } catch {
        personId = null;
      }
      if (!personId) return json({ error: 'personId required.' }, 400, origin);
      const result = await broadcastBirthdayForPerson(env, personId);
      return json(result, result.error ? 404 : 200, origin);
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
    // An explicit request to ADD/CREATE a new person and attach them to an
    // existing one — e.g. "add Ravi as son of Kumar". The client derives the
    // action/gender and only writes after an on-screen confirm; here we just
    // pass the three raw strings through once their presence is validated.
    if (
      parsed?.type === 'add-person' &&
      typeof parsed.name === 'string' &&
      typeof parsed.relationWord === 'string' &&
      typeof parsed.target === 'string'
    ) {
      return json({ type: 'add-person', name: parsed.name, relationWord: parsed.relationWord, target: parsed.target }, 200, origin);
    }
    // Whitelisted fields only — never trust the model to keep to the seven, so
    // it can't smuggle in a phone/email lookup the client would then run.
    const ATTR_FIELDS = new Set(['work', 'location', 'gender', 'status', 'birthYear', 'name', 'any', 'all']);
    if (parsed?.type === 'attribute-query' && typeof parsed.field === 'string' && ATTR_FIELDS.has(parsed.field)) {
      return json(
        { type: 'attribute-query', field: parsed.field, value: typeof parsed.value === 'string' ? parsed.value : '', aggregate: !!parsed.aggregate },
        200,
        origin
      );
    }
    return json({ type: 'unknown' }, 200, origin);
  },

  async scheduled(controller, env, ctx) {
    // The service account is read-only by design (see firestore.js), so
    // there's no Firestore write available to mark "already sent today" for
    // idempotency. Rather than let a mid-job failure trigger Cloudflare's
    // automatic scheduled() retry (which risks double-sending the emails
    // that already went out before the failure), this opts out of retry
    // entirely — a transient failure means no email that day, logged via
    // `wrangler tail` for manual follow-up, which is the safer failure mode
    // for a nice-to-have feature like this.
    controller.noRetry();
    await runBirthdayJob(env);
  },
};
