# Family Tree

A React + Vite web app for building and exploring a shared family tree, with
first-class support for Tamil kinship terms (Periyappa, Chithi, Machaan, …)
alongside English ones, computed automatically from the tree structure rather
than typed in by hand.

Live at:
- Custom domain: https://familyroots.co.in
- Firebase Hosting: https://family-tree-3b760.web.app
- GitHub Pages (mirror): https://mani14.github.io/familytree/

## What it does

- **One shared family tree**, stored in a single Firestore document, editable
  by anyone signed in with Google — additions/edits are visible to the whole
  family in real time.
- **Lineage/Pedigree View** — one person's own father-side + mother-side
  ancestry with descendants hanging below; pan, zoom, MiniMap,
  collapse/expand. Tracing a connection temporarily widens to the full family
  forest (every lineage side by side) so the whole path can be drawn.
- **Relationship terms computed automatically**, in English and Tamil, for
  any pair of people — not just direct family, but cousins, in-laws,
  removed-uncles, chained relationships through multiple marriages, etc. See
  [`src/utils/familyUtils.js`](src/utils/familyUtils.js).
- **Relationship-term corrections (admin)** — if a computed Tamil term is
  wrong for your family's actual usage, an admin can fix it once (via the
  pencil on a person's relationship badge, or **Admin Settings → Relationship
  Rules**) and it applies to every pair sharing that same relationship
  *shape*, not just the two people you were looking at.
- **"Ask About the Family"** — a plain-English box (type or **speak** via the
  mic) that answers questions ("How is X related to Y?", "Who are X's
  cousins?", "Whose birthday is coming up next?"), searches recorded details
  ("who works as a teacher?", "who lives in Chennai?", "how many people are in
  the tree?", or by gender / living-or-deceased / birth year / name), **and
  can change the tree** — add a person ("add Ravi as son of Kumar"), set a
  field ("set Kumar's job to teacher", "Ravi lives in Chennai"), mark someone
  deceased/living, or record a marriage ("Ravi married Priya") — always with
  an on-screen confirm before anything is saved. Understanding the question is
  AI-assisted (a free-tier LLM via a small Cloudflare Worker); computing the
  answer — and parsing every *write* command — always stays local, using the
  same deterministic engine as everywhere else. Write commands in particular
  are detected strictly locally and never sent to the AI. See
  [Architecture](#architecture) below, [`src/utils/naturalQuery.js`](src/utils/naturalQuery.js),
  and [`worker/`](worker).
- **Descendants chart** — from any person's card, an indented,
  collapsible tree of all their descendants ("12 children · 30 grandchildren · …"),
  each row tapping through to that person. See
  [`src/components/DescendantsPanel.jsx`](src/components/DescendantsPanel.jsx).
- **Timeline** (admin) — every birth, marriage, and death in chronological
  order. See [`src/components/TimelinePanel.jsx`](src/components/TimelinePanel.jsx).
- **Find Connection** — pick any two people and watch an animated path trace
  the blood/marriage connection between them, narrating each stop.
- **"Show our link" & "How you're related"** — on any person's card, one tap
  drives that same animated path from *you* (your linked person) to them; the
  relationship term itself is a link that opens a step-by-step explanation of
  every hop in the chain.
- **Daily birthday-alert emails** — a Cloudflare Worker Cron Trigger emails
  the birthday person directly (if they've linked their own account) and,
  if an admin has turned it on, every signed-in family member on someone's
  birthday. See [Architecture](#architecture) below.
- **Family Map** — everyone's pinned location (current or native place) on a
  real map.
- **Data Health Check** (admin) — flags dangling references, asymmetric
  links, and unfilled placeholder records.
- **Import/Export** as JSON **or GEDCOM** (the standard genealogy format used
  by Ancestry/MyHeritage/FamilySearch), plus export the tree as an Image or
  PDF. See [`src/utils/gedcom.js`](src/utils/gedcom.js).
- Full undo/redo, drag-to-reorder siblings (birth order), dark mode, "Add Me"
  self-linking, per-person personal root ("Set as Root"/"Locate Me"), and one
  global search (by name, job, or place).

For the full up-to-date feature list as shown to users, see the in-app
**How to use the app** page ([`src/components/FeatureShowcase.jsx`](src/components/FeatureShowcase.jsx)).

## Tech stack

- **Frontend**: React 18 + Vite, plain CSS (no framework), Framer Motion for
  animation, Lucide for icons.
- **Data**: Firebase Firestore — one shared document (`families/main`) holds
  the entire tree; small per-user documents hold personal preferences.
- **Auth**: Firebase Authentication, Google sign-in only.
- **Hosting**: Firebase Hosting *and* GitHub Pages, both auto-deployed on
  every push to `master` (two independent CI pipelines — see
  [Deployment](#deployment)).
- **AI-assisted question parsing**: a Cloudflare Worker (free tier) calling
  Groq's free-tier LLM API — see [Architecture](#architecture).
- **Birthday-alert email job**: the same Cloudflare Worker also runs a daily
  Cron Trigger, reading Firestore directly (via a narrowly-scoped, read-only
  Google service account — Workers can't use the Node-only `firebase-admin`
  SDK, so this hand-rolls the same from-scratch JWT approach already used
  for verifying Firebase ID tokens) and sending mail via **Brevo**'s free
  tier — see [Architecture](#architecture).
- **Backups**: a Google Apps Script, running on a daily schedule under your
  own Google account, saving JSON snapshots to your own Drive — see
  [`backup/`](backup/README.md).

No backend server of its own beyond the one small Cloudflare Worker; nothing
here needs a paid plan anywhere.

## Architecture

```
┌─────────────────────┐        ┌──────────────────────────┐
│   Browser (React)    │◄──────►│  Firebase Auth (Google)  │
│                      │        └──────────────────────────┘
│  - relationship       │        ┌──────────────────────────┐
│    engine (LOCAL,    │◄──────►│  Firestore                │
│    deterministic)    │        │  families/main (the tree) │
│  - all UI/state       │        │  families/relationshipOverrides│
└──────────┬───────────┘        │  users/{uid}, settings/*  │
           │                    └───────────────▲──────────┘
           │ question TEXT ONLY,                 │ read-only, service-account
           │ never family data                   │ JWT (no signed-in user)
           ▼                                      │
┌──────────────────────┐        ┌──────────────────────────┐
│  Cloudflare Worker    │◄──────►│  Groq API (free tier)     │
│  (worker/src/index.js)│        │  LLM: intent extraction   │
│  - fetch(): verifies  │        │  only, e.g. {type:        │
│    Firebase ID token, │        │  "relation-between", ...} │
│    proxies to Groq    │        └──────────────────────────┘
│  - scheduled(): daily │        ┌──────────────────────────┐
│    cron, birthday job │◄──────►│  Brevo API (free tier)    │
└──────────────────────┘        │  transactional email      │
                                 └──────────────────────────┘
```

The Worker does two unrelated jobs behind one `export default`: `fetch()` handles
the Ask panel (verifies the caller's Firebase ID token, proxies to Groq — no
Firestore access at all), and `scheduled()` handles the daily birthday email —
the opposite shape, no signed-in user to check, but real Firestore reads via a
dedicated, narrowly-scoped (read-only) service account, since Workers can't use
the Node-only `firebase-admin` SDK. See `worker/src/firestore.js`'s comment for
how that JWT is hand-rolled with the `jose` package already used for ID-token
verification.

The important design decision: **the AI never answers anything and never
sees family data.** It only ever converts a free-form question into a small
structured intent (`relation-between`, `relation-list`, `birthday-next`,
`attribute-query`, `add-person`, or `meta`); the actual lookup — including
every Tamil kinship rule — runs entirely in the browser via the same functions
used everywhere else in the app. The *write* intents — `add-person` and the
edit commands (set a field, mark deceased/living, record a marriage) — are even
stronger: they're detected entirely by local regex and **never sent to the
Worker at all**, so a command can't be misrouted by the model — and they still
only write after an explicit on-screen confirm. `parseQueryAI` in
`src/utils/naturalQuery.js` falls back automatically to a local regex-based
parser if the Worker is unreachable, so the feature degrades gracefully rather
than breaking outright.

The Worker is on **Cloudflare**, not Firebase Cloud Functions, specifically
because Firebase Functions require the paid Blaze plan just to make an
outbound call to a non-Google API (Groq), even though actual usage stays
within free-tier limits — Cloudflare Workers' free tier has no such
requirement. See the comment at the top of
[`worker/src/index.js`](worker/src/index.js).

## Data model

The whole tree lives in one Firestore document, `families/main`:

```jsonc
{
  "rootPersonId": "abc123",       // default focus person for new/unlinked visitors
  "persons": {
    "abc123": {
      "id": "abc123",
      "firstName": "…", "lastName": "…", "petName": "…",
      "gender": "male" | "female" | "other",
      "dob": "YYYY-MM-DD" | "YYYY" | "",   // year-only supported for date of death
      "dod": "…", "isAlive": true,
      "work": "…", "phone": "…", "email": "…", "notes": "…",
      "location": "…", "locationLat": null, "locationLng": null, "locationApproximate": false,
      "photo": "data:image/jpeg;base64,…",  // downscaled client-side before upload
      "spouseId": "…", "marriageDate": "…",
      "parentIds": ["…"],      // 0–2 entries; positional [father, mother] where known
      "childrenIds": ["…"],    // order = birth order (drag-to-reorder in the UI)
      "isPlaceholder": true,   // auto-created "Unknown Parent" stand-in — see addSibling
      "verifiedEmail": "…"     // set once someone links this person to their own account
    }
  }
}
```

Other documents:
- `families/relationshipOverrides` — user-authored corrections to computed
  Tamil terms, keyed by a *relationship signature* (distance/side/gender/
  order — not by which two people), so a fix generalizes to every pair
  sharing that same shape. See `getRelationshipSignature` in
  `familyUtils.js`.
- `users/{uid}` — `{ meId, rootId, email }`: which person this signed-in
  account is linked to as "you", their own personal default tree root, and
  their own login email (cached here since the birthday-alert Worker cron
  can only read Firestore, not Firebase Auth directly). Never shared with
  anyone else.
- `settings/admins`, `settings/app` — admin list and app-wide feature toggles
  (see Admin Settings in the app), including the birthday-alert email job's
  master on/off switch.

Firestore security rules ([`firestore.rules`](firestore.rules)): any
signed-in user can read/write the shared tree and relationship overrides;
`users/{uid}` is private to that account (plus admins); `settings/*` is
admin-write, signed-in-read.

## Local development

```bash
npm install
npm run dev       # http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve the production build locally
```

Firebase's web config (`src/lib/firebase.js`) is committed directly — these
are public client identifiers by design (safe to ship; the actual access
control is Firebase Auth + Firestore rules, not secrecy of these values).

`.env.local.example` documents a `VITE_GOOGLE_CLIENT_ID` variable, mirrored
as a build-time env var in both GitHub Actions workflows — but nothing in
`src/` currently reads it. It's a leftover from an earlier auth approach
before the app settled on Firebase's own `GoogleAuthProvider` popup flow;
harmless to leave, safe to remove if you want to clean it up.

## Deployment

Two independent, automatic pipelines, both triggered on every push to
`master` ([`.github/workflows/`](.github/workflows)):

1. **Firebase Hosting** (`deploy-firebase.yml`) — builds, then deploys via
   `FirebaseExtended/action-hosting-deploy`, authenticated with a
   `FIREBASE_SERVICE_ACCOUNT` repo secret.
2. **GitHub Pages** (`deploy-pages.yml`) — builds, uploads as a Pages
   artifact, deploys via `actions/deploy-pages`.

Nothing needs to be run manually for a normal frontend change — push to
`master` and both deployments happen on their own.

### The Cloudflare Worker (Ask panel + birthday emails) is separate

The Worker is **not** part of either CI pipeline above — it has its own,
manual deploy, from inside `worker/`:

```bash
cd worker
npm install
npx wrangler login                      # one-time, opens a browser
npx wrangler secret put GROQ_API_KEY    # Ask panel's Groq access
npx wrangler secret put BREVO_API_KEY   # birthday emails, sent via Brevo
npx wrangler secret put GCP_SERVICE_ACCOUNT_JSON < path\to\key.json  # see below
npx wrangler deploy
```

`GCP_SERVICE_ACCOUNT_JSON` is the full key file (piped in whole, not typed —
preserves the private key's real newlines) of a **dedicated, read-only**
Google service account (`roles/datastore.viewer` only, granted in Google
Cloud Console under the same `family-tree-3b760` project) — deliberately
*not* the full-access Firebase Admin key used elsewhere, since this one only
ever needs to read Firestore on a schedule with nobody signed in. The daily
schedule itself lives in `worker/wrangler.toml`'s `[triggers]` block (UTC —
recompute by hand if the target local time changes).

If you ever change `worker/src/index.js` (e.g. the system prompt, the model,
a new question type, the birthday job's logic), you need to re-run
`npx wrangler deploy` yourself — pushing to `master` does not redeploy it.

### Firestore rules

```bash
firebase deploy --only firestore:rules
```

Also not automated — deploy manually whenever `firestore.rules` changes.

## Backups

A Google Apps Script runs daily under your own Google account, saving a JSON
snapshot of the whole tree into a "Family Tree Backups" folder in your own
Google Drive — no paid plan, no new hosting, nothing added to this repo's
infrastructure. Full setup and restore instructions:
[`backup/README.md`](backup/README.md).

## Testing approach

There's a small **Vitest** suite (`npm test`, or `npm run test:watch`)
covering the pure logic: `src/utils/familyUtils.test.js` (the relationship
engine), `src/utils/naturalQuery.test.js` (Ask parsing, add/edit commands, and
answer resolution), `src/utils/gedcom.test.js` (GEDCOM round-trip), and
`src/utils/dataHealth.test.js`. Run it after any change to those files.

Beyond the committed suite, the relationship engine (`familyUtils.js`,
`naturalQuery.js`) is pure, dependency-light JS, so trickier cases are also
verified with small ad-hoc Node scripts: construct a synthetic `persons`
object, import the function directly via a `file://` URL, and assert on the
output. (`familyUtils.js` is import-safe in plain Node; `naturalQuery.js`
also pulls in `src/lib/firebase.js`, so a throwaway script that imports it
should call `process.exit(0)` at the end, or Firebase's keep-alive holds the
process open.)

For anything UI-facing, verify manually with `npm run dev` — a real Google
sign-in is required for most flows (multi-account behavior, the Ask panel's
ID-token verification, etc. can't be scripted headlessly).

## Project structure

```
src/
  App.jsx                    — top-level state, view routing, all modal wiring
  components/                — one file per UI piece (PersonDetail, PersonForm,
                                FamilyTree, AskPanel, AdminPanel, ...)
  hooks/
    useFamily.js              — the shared tree: CRUD, undo/redo, Firestore sync
    useAuth.js                 — Firebase Auth + per-user meId/rootId prefs
    useAdmin.js, useAppSettings.js, useRelationshipOverrides.js
    useTreeLayout.js           — forest/pedigree layout algorithms
  utils/
    familyUtils.js             — the relationship engine (English + Tamil kinship
                                  logic, signatures, path-finding) — the core of the app
    naturalQuery.js            — Ask panel's question parsing + answer resolution
                                  (relationship/attribute/count queries + add/edit commands)
    gedcom.js                   — GEDCOM import/export (INDI/FAM ↔ the app's data shape)
    *.test.js                   — Vitest suites (familyUtils, naturalQuery, gedcom, dataHealth)
    dataHealth.js               — Data Health Check's consistency scan
    relationshipReference.js, tamilRelationshipTerms.js — reference data
    mapTiles.js, mapMarkers.js  — Family Map's tile/marker helpers
  lib/firebase.js             — Firebase app/auth/Firestore initialization
  data/family.json             — seed data (used by "Reset Shared Tree to Seed")
worker/                        — Cloudflare Worker: Ask panel's AI intent classifier
                                  + daily birthday-alert email job
  src/index.js                  — fetch() (Ask panel) and scheduled() (birthday job)
  src/firestore.js              — hand-rolled service-account JWT + Firestore REST reads
  src/email.js, emailTemplates.js — Brevo send + the decorated HTML email templates
backup/                        — Google Apps Script: daily Firestore → Drive backup
firestore.rules, firestore.indexes.json, firebase.json, .firebaserc
```

## Historical note

[`PLAN.md`](PLAN.md) is the project's original planning document from before
Firebase/Firestore was introduced (it still describes a localStorage-based,
single-device design) — kept for history, but this README is the current
source of truth.
