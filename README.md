# Family Tree

A React + Vite web app for building and exploring a shared family tree, with
first-class support for Tamil kinship terms (Periyappa, Chithi, Machaan, …)
alongside English ones, computed automatically from the tree structure rather
than typed in by hand.

Live at:
- Firebase Hosting: https://family-tree-3b760.web.app
- GitHub Pages (mirror): https://mani14.github.io/familytree/

## What it does

- **One shared family tree**, stored in a single Firestore document, editable
  by anyone signed in with Google — additions/edits are visible to the whole
  family in real time.
- **Full Tree View** (every lineage side by side) and **Lineage/Pedigree
  View** (one person's own father-side + mother-side ancestry, descendants
  hanging below) — pan, zoom, MiniMap, collapse/expand.
- **Relationship terms computed automatically**, in English and Tamil, for
  any pair of people — not just direct family, but cousins, in-laws,
  removed-uncles, chained relationships through multiple marriages, etc. See
  [`src/utils/familyUtils.js`](src/utils/familyUtils.js).
- **Self-service relationship-term corrections** — if a computed Tamil term
  is wrong for your family's actual usage, fix it once and it applies to
  every pair sharing that same relationship *shape*, not just the two people
  you were looking at.
- **"Ask About the Family"** — a plain-English question box ("How is X
  related to Y?", "Who are X's cousins?", "Whose birthday is coming up
  next?"). Understanding the question is AI-assisted (a free-tier LLM via a
  small Cloudflare Worker); computing the actual answer always stays local,
  using the same deterministic relationship engine as everywhere else. See
  [Architecture](#architecture) below, [`src/utils/naturalQuery.js`](src/utils/naturalQuery.js),
  and [`worker/`](worker).
- **Find Connection** — pick any two people and watch an animated path trace
  the blood/marriage connection between them, narrating each stop.
- **Daily birthday-alert emails** — a Cloudflare Worker Cron Trigger emails
  the birthday person directly (if they've linked their own account) and,
  if an admin has turned it on, every signed-in family member on someone's
  birthday. See [Architecture](#architecture) below.
- **Family Map** — everyone's pinned location (current or native place) on a
  real map.
- **Data Health Check** (admin) — flags dangling references, asymmetric
  links, and unfilled placeholder records.
- **Import/Export** as JSON, plus export the tree as an Image or PDF.
- Full undo/redo, drag-to-reorder siblings (birth order), dark mode, "Add Me"
  self-linking, per-person personal root ("Set as Root"/"Locate Me").

For the full up-to-date feature list as shown to users, see the in-app
**Demo** page ([`src/components/FeatureShowcase.jsx`](src/components/FeatureShowcase.jsx)).

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
structured intent (`{type, nameA/nameB/name, relationWord}`); the actual
relationship lookup — including every Tamil kinship rule — runs entirely in
the browser via the same functions used everywhere else in the app.
`parseQueryAI` in `src/utils/naturalQuery.js` falls back automatically to a
local regex-based parser if the Worker is unreachable, so the feature
degrades gracefully rather than breaking outright.

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

There's no formal test suite / CI test step. The relationship engine
(`familyUtils.js`, `naturalQuery.js`) is pure, dependency-free JS, so changes
are verified with small ad-hoc Node scripts: construct a synthetic `persons`
object, import the function directly via a `file://` URL, and assert on the
output. This pattern — accumulated across many bug fixes — is the closest
thing to a regression suite for the relationship logic; there isn't a
committed test directory for it currently.

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
