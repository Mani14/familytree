# CLAUDE.md

Guidance for AI agents (Claude Code or otherwise) working in this repo. See
[README.md](README.md) first for what the app does and how it's built —
this file is about *how to work on it*, not what it is.

## The one thing to understand before touching anything

This app has a deliberate split: **relationship computation is 100% local
and deterministic** (`src/utils/familyUtils.js`), while the Ask panel's AI
(`worker/`, Groq) is used *only* to turn a free-form question into a small
structured intent — it never computes an answer and never sees family data.
Any change that blurs this line (e.g. "just send the AI the data so it can
answer directly") should be pushed back on, not implemented — it was tried
and rejected earlier for accuracy (LLMs guess, this app's answers are always
computed correctly), privacy (family data would leave the browser), and cost
(bigger prompts burn the free tier faster). If a new kind of question needs
answering, add a new intent type the same way `birthday-next` was added:
classify locally + via the Worker, resolve the answer with real code.

## Working conventions established in this repo

- **Build after every change**: `npm run build`. It's fast and catches
  real mistakes (bad imports, JSX errors) before they reach the user.
- **Test the relationship engine with throwaway Node scripts**, not a
  formal test framework (there isn't one). `familyUtils.js` and
  `naturalQuery.js` have zero external side effects at import time safe
  enough for this, so:
  ```js
  import { getRelationshipLabelTamil } from 'file:///C:/absolute/path/to/src/utils/familyUtils.js';
  // build a synthetic `persons` object, call the function, console.log and eyeball it
  ```
  Keep these scripts around (in the session scratchpad) and re-run the
  accumulated set after any engine change — they're the only regression
  coverage that exists for this logic. Don't delete them as "cleanup."
- **Only commit/push when explicitly asked.** Default to leaving changes
  uncommitted after making them, and say so. "push" means commit *and* push
  everything pending, not just the most recent change.
- **Comments explain WHY, never WHAT.** Identifiers should already make the
  "what" obvious. A comment earns its place only if it captures a
  non-obvious constraint, a workaround, or a decision that would otherwise
  get silently "cleaned up" and reintroduce a bug.
- **No unprompted refactors, no speculative abstractions, no new
  dependencies without a real need.** This app has been built incrementally,
  feature request by feature request — match that grain.

## Known gotchas (things that will bite you if you don't know them)

- **CSS specificity trap**: `.person-form label { flex-direction: column }`
  (PersonForm.css) applies to *every* label in that form, including new ones
  you add. A new `<label>` with `display: flex; flex-direction: row` inside
  `.person-form` will silently lose to that rule unless your selector has
  higher specificity (an extra ancestor class, not just the element's own
  class). This exact bug shipped once (the photo "Update Photo" button
  stacked icon-over-text instead of side-by-side) — check computed styles,
  not just the CSS you wrote, if a form control's layout looks wrong.
- **iOS Safari swallows touch events on anything overlaid on top of a native
  `<input type="date">`/`type="time">`**, even with correct z-index — the OS
  claims the whole bounding box for its own picker. Never place a clickable
  overlay (like a clear/× button) *on top of* a native date input; put it as
  a separate sibling element instead. This also shipped once and had to be
  fixed after a live iPhone test report.
- **A person's relationship to themselves must short-circuit before any
  fallback logic runs**, not just at the primary computation. The chained
  resolvers (`resolveTamilTermChained`/`resolveEnglishTermChained` in
  `familyUtils.js`) each have an explicit `if (personId === rootId) return
  null` at the very top — if you refactor these, keep that guard exactly
  where it is. Without it, viewing your own profile can show your own
  sibling's term as if it were your relationship to yourself (a real bug
  that shipped and was fixed this way).
- **Firestore field order isn't guaranteed to round-trip.** Relationship
  signatures are compared via a fixed-field-order tuple
  (`signatureFingerprint`/`SIGNATURE_FIELDS` in `familyUtils.js`), never a
  naive `JSON.stringify` of the raw object — don't "simplify" that back to
  a plain stringify.
- **Google Apps Script's `DriveApp` service does not work under the
  narrower `drive.file` OAuth scope** — `createFolder`/`getFoldersByName`
  both require the full `drive` scope. Don't try to re-narrow
  `backup/appsscript.json`'s Drive scope without re-verifying this; it was
  tried and reverted (see the comment at the top of
  `backup/family-tree-backup.gs`).
- **The Cloudflare Worker has its own deploy step** (`cd worker && npx
  wrangler deploy`) — it is *not* part of either GitHub Actions pipeline and
  will not redeploy just because you pushed to `master`. If you change
  `worker/src/index.js`, say so explicitly and deploy it, or the live app
  keeps using the old version.
- **Tamil kinship logic is classificatory (Dravidian-system), not
  Western/literal.** Parallel cousins (same-gender connecting parents) are
  treated as siblings (Anna/Thangai); cross cousins (opposite-gender
  connecting parents) get Machaan/Machinichi. Marrying in *inverts*
  paternal/maternal classification relative to your spouse (a spouse's
  mother's-brother, cross-side to your spouse, becomes same-side
  Periyappa/Chithappa to you). Don't "fix" what looks like an inconsistency
  here without first checking whether it's actually this rule in effect —
  read the extensive comments in `familyUtils.js` around
  `tamilUncleAuntPairTerm`'s `invertSide` parameter first.
- **A Grep-tool display quirk**: search results have occasionally rendered
  `//` (a real comment marker in the file) as a stray `\` in this
  environment. If a Grep result shows something like `\ Fallback #3:` where
  a `//` comment would make more sense, re-read the file directly with the
  Read tool before assuming the file is actually broken — it usually isn't.

## Secrets and credentials

- **Firebase web config** (`src/lib/firebase.js`) is intentionally public —
  these are client identifiers, not secrets. Don't treat them as sensitive.
- **Groq API key** lives only in Cloudflare's secret store (`wrangler secret
  put GROQ_API_KEY`), never in any committed file. If you ever see it in
  plaintext anywhere (chat, a file, a log), treat that as a rotation event.
- **Firebase service account** (`FIREBASE_SERVICE_ACCOUNT` GitHub secret)
  and **Cloudflare account access** are the two credentials with real
  blast radius in this project — don't request or handle these casually.
- Never suggest routing around the Blaze-plan constraint by just paying for
  it without asking first — the user has consistently preferred staying on
  free tiers and re-architecting (Cloudflare instead of Firebase Functions)
  to do so. Surface the tradeoff; let them decide.

## User's working style (learned this session)

- Prefers being asked before large architectural changes (new backend
  services, new paid tiers, new third-party APIs) — treat these as genuine
  decisions, not obvious next steps.
- Wants concrete root-cause explanations for bugs, not just "fixed it" —
  when something breaks, explain what was actually wrong before describing
  the fix.
- Reports issues via screenshots from the live app frequently — when a
  screenshot shows unexpected behavior, verify against the actual current
  code/data rather than assuming the report is imprecise.
- Says "push" to mean "commit and push everything pending," not just the
  latest change — check `git status` for the full pending set before
  committing.
