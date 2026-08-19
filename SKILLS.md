# SKILLS.md

Step-by-step procedures for common tasks in this repo. See
[README.md](README.md) for what things are, [CLAUDE.md](CLAUDE.md) for
conventions and gotchas — this file is the "how do I actually do X" runbook.

## Ship a normal frontend change

1. Make the change.
2. `npm run build` — must succeed with no errors.
3. If you touched `src/utils/familyUtils.js` or `src/utils/naturalQuery.js`,
   re-run the accumulated Node-script regression suite (see "Test a
   relationship-engine change" below) before considering it done.
4. Only commit/push if explicitly asked:
   ```bash
   git add <specific files>   # never -A / . — review what's staged
   git commit -m "…"
   git push
   ```
   Pushing to `master` automatically triggers both deploy pipelines (Firebase
   Hosting + GitHub Pages) — no further action needed for a pure frontend
   change.

## Test a relationship-engine change

`familyUtils.js` has zero external imports, so it can be exercised directly
in plain Node without any build step:

```js
// scratch.mjs
import { getRelationshipLabel, getRelationshipLabelTamil } from
  'file:///C:/Users/.../src/utils/familyUtils.js';

function P(id, overrides = {}) {
  return { id, gender: 'male', parentIds: [], childrenIds: [], spouseId: null, dob: '', firstName: id, lastName: '', ...overrides };
}
const persons = {};
// ...build a small synthetic family matching the case you're testing...

console.log(getRelationshipLabel(persons, 'someId', 'rootId'));
console.log(getRelationshipLabelTamil(persons, 'someId', 'rootId'));
```

Run with `node scratch.mjs`. Keep every such script from a session — re-run
all of them after any further engine change, since this is the only
regression coverage this logic has. A new bug fix should usually get its own
new script covering the exact reported case, not just a manual spot-check.

`naturalQuery.js` also imports `src/lib/firebase.js` (for the Ask panel's
auth), but Firebase's client SDK initializes lazily enough that this still
works fine in plain Node for testing `parseQuery`/`resolveAnswer` — network
calls (`parseQueryAI`) will fail fast (no browser session) and fall back to
the local parser, which is fine for testing that fallback path itself.

## Add a new "Ask About the Family" question type

Follow the exact pattern `birthday-next` was added with (see the commit that
introduced it):

1. Add local regex detection in `parseQuery` (`naturalQuery.js`) — a rough
   keyword match is fine; it doesn't need to be exhaustive since the AI path
   handles looser phrasing.
2. Add the same intent shape to the Worker's `SYSTEM_PROMPT`
   (`worker/src/index.js`), and pass it through in the response-validation
   block at the bottom of the `fetch` handler.
3. Add the shape to `parseQueryAI`'s response validation (`naturalQuery.js`).
4. Add a branch in `resolveAnswer` that computes the actual answer using
   real local logic — never have the AI "just answer" the new question type.
5. Add a render branch in `AskPanel.jsx`'s `AnswerBody` for the new result
   `kind`.
6. Redeploy the Worker (see below) — steps 1/3/4/5 take effect on next
   `npm run build`+push, but step 2 needs a manual Worker deploy.
7. Verify the new phrasing against Groq directly before trusting it live:
   ```bash
   cd worker
   node -e "
   const fs = require('fs');
   const prompt = fs.readFileSync('./src/index.js','utf8').match(/const SYSTEM_PROMPT = \`([\s\S]*?)\`;/)[1];
   fetch('https://api.groq.com/openai/v1/chat/completions', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
     body: JSON.stringify({ model: 'openai/gpt-oss-20b', response_format: {type:'json_object'}, temperature: 0, max_tokens: 500, reasoning_effort: 'low',
       messages: [{role:'system',content:prompt},{role:'user',content:'YOUR TEST QUESTION HERE'}] }),
   }).then(r=>r.json()).then(d=>console.log(d.choices?.[0]?.message?.content));
   "
   ```

## Deploy the Cloudflare Worker

```bash
cd worker
npm install                      # first time only
npx wrangler login                # first time only, opens a browser
npx wrangler secret put GROQ_API_KEY   # first time, or when the key rotates
npx wrangler deploy
```

Verify it's live and correctly rejecting unauthenticated requests:
```bash
curl -s -X POST https://family-tree-ask-worker.manikandan-ks-14.workers.dev \
  -H "Content-Type: application/json" -d '{"question":"test"}'
# expect: {"error":"Sign-in required."}
```

## Rotate the Groq API key

1. Generate a new key at https://console.groq.com.
2. `cd worker && printf '<new key>' | npx wrangler secret put GROQ_API_KEY`
   (no `wrangler deploy` needed — secrets apply to the already-deployed
   Worker immediately).
3. Revoke the old key in the Groq console.

## Deploy Firestore rules

```bash
firebase deploy --only firestore:rules
```

Not automated by CI — do this manually whenever `firestore.rules` changes,
before relying on the new rules being live.

## Check who's actually logged in

The app itself can't show this (Firebase Auth data for *other* accounts
isn't readable from the client SDK, by design — see `AdminPanel.jsx`'s
"Linked Accounts" section, which shows tree-linkage instead as a proxy).
For real login data: **Firebase Console → Authentication → Users**
(https://console.firebase.google.com/project/family-tree-3b760/authentication/users).

## Bulk-edit live Firestore data directly (Admin SDK)

For a data fix that touches many people at once by name (e.g. "set these 18
people's job title") — too tedious to do one-by-one in the UI, but not worth
building a permanent admin feature for a one-off. This bypasses the app (and
its Undo) entirely, so treat it as a real, confirmed-before-you-write action,
not a routine one:

1. **Check for a service-account key first** — if one isn't already sitting
   somewhere local (this project's has shown up in the user's Downloads
   folder as `family-tree-*-firebase-adminsdk-*.json` more than once), you'd
   need one generated via Firebase Console → Project Settings → Service
   Accounts, which is itself worth flagging rather than doing silently (see
   CLAUDE.md's Secrets section — this is the single highest-blast-radius
   credential in the project).
2. Set up a throwaway scratchpad project (don't add `firebase-admin` to this
   repo's own `package.json` — it's a one-off tool, not an app dependency):
   ```bash
   mkdir /path/to/scratchpad/fb-admin-task && cd $_
   npm init -y && npm install firebase-admin
   ```
3. **Fetch the live document first and match names against it before writing
   anything** — never assume a name string maps to one obvious person. This
   family tree has multiple people sharing an exact full name, and several
   women recorded under a married-in surname (their spouse's first name), so
   a name from a casual request often isn't the literal person/field key:
   ```js
   import { initializeApp, cert } from 'firebase-admin/app';
   import { getFirestore } from 'firebase-admin/firestore';
   import { readFileSync } from 'fs';
   initializeApp({ credential: cert(JSON.parse(readFileSync('<key path>', 'utf8'))) });
   const db = getFirestore();
   const persons = (await db.doc('families/main').get()).data().persons;
   // fuzzy-match target names against persons, print id + current value + proposed
   // value for EVERY match, and flag ambiguous/no-match cases instead of guessing
   ```
4. **Show the full resolved mapping to the user and get explicit confirmation
   before writing** — especially for any name that needed fuzzy-matching,
   spouse-lookup, or had more than one candidate.
5. **Write with dot-notation field paths, never a full-document `.set()`** —
   this only touches the specific leaf fields you mean to change, so a
   concurrent edit from someone else's browser tab isn't clobbered:
   ```js
   await db.doc('families/main').update({
     'persons.someId.work': 'Software Engineer',
     // ...one entry per field per person
   });
   ```
6. Read the document back and print a before/after diff for every id touched,
   so the confirmation in chat is backed by a real post-write read, not just
   "the call didn't throw."
7. Tell the user afterward that this bypassed Undo — if something needs
   correcting, it's a manual fix or another script, not one click.

For anything that ISN'T a rare bulk one-off (recurring corrections, something
a non-technical family member should be able to do themselves), build a real
admin-panel action instead (see `AdminPanel.jsx`'s "Fill Missing Surnames" /
"Update Married Surnames" for the pattern: compute candidates, show a
reviewable preview, apply as one `bulkUpdatePersons` call so it's one Undo
step) — that stays inside the app's own permission model and Undo history.

## Run a throwaway script that imports a file with internal relative imports

`familyUtils.js` has zero internal imports, so importing it directly via a
`file:///…` URL in plain Node (see "Test a relationship-engine change" above)
just works. Files that import *other* project files without an extension
(Vite/webpack-style, e.g. `useTreeLayout.js`'s `from '../utils/familyUtils'`)
don't — plain Node ESM requires an explicit `.js` and fails with
`ERR_MODULE_NOT_FOUND`. Bundle it with the project's own `esbuild` first
(already a transitive dependency, no install needed) rather than rewriting
the target file's imports or giving up on testing it in isolation:

```bash
./node_modules/.bin/esbuild your-script.mjs --bundle --platform=node \
  --format=esm --outfile=your-script.bundle.mjs --external:fs
node your-script.bundle.mjs
```

Use plain `C:/...`-style absolute paths (or paths relative to the script) in
the script's own imports, not `file:///C:/...` URLs — esbuild's resolver
doesn't accept `file://` specifiers the way Node's own loader does.

## Restore from a backup

Any file in the "Family Tree Backups" Google Drive folder is already in the
exact shape the app's own Import expects — open the app, Download menu →
Import JSON, pick the dated file. This *replaces* the whole live tree with
that snapshot (Undo covers it, but only until the app is closed). Full
backup setup/detail: [`backup/README.md`](backup/README.md).

## Diagnose "the Ask panel isn't working" reports

In rough order of likelihood, based on issues actually hit building this
feature:
1. **Stale dev server / browser cache** — ask for a hard refresh
   (Ctrl+Shift+R) and a dev-server restart before anything else.
2. **Groq model deprecated** — check `curl https://api.groq.com/openai/v1/models
   -H "Authorization: Bearer $GROQ_API_KEY"` against the model name in
   `worker/src/index.js`'s `GROQ_MODEL` constant; Groq's lineup changes.
3. **Truncated JSON from a reasoning model** — if Groq returns a 400
   `json_validate_failed`, the model likely ran out of `max_tokens` mid
   chain-of-thought before emitting the final JSON. Raise `max_tokens`
   and/or set `reasoning_effort: 'low'`.
4. **A genuine hang, not a slow response** — check that *every* async step
   in the chain has a timeout (token fetch, the Worker call, the Worker's
   own Google-certs fetch, the Worker's own Groq call) — a stall in any one
   of them with no timeout hangs the whole UI on "Thinking…" indefinitely.
   `parseQueryAI` wraps the *entire* attempt in one `Promise.race` deadline
   for exactly this reason — don't add a new async step outside that race.
5. **Ask for the browser console error text directly** (F12 → Console) if
   none of the above explain it — this has been the fastest way to actually
   pin down a real bug every time it's come up.

---

If this file's scope doesn't match what you had in mind (e.g. you wanted an
actual Claude Code Skill definition rather than a plain runbook), say so and
it can be restructured.
