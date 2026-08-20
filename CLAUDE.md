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
- **Run the test suite**: `npm test` (Vitest — `familyUtils.test.js`,
  `naturalQuery.test.js`, `dataHealth.test.js`). Add a case here for any new
  relationship-engine or Ask-parsing behavior; keep it green.
- **Also test the relationship engine with throwaway Node scripts** for
  quick exploration beyond the committed suite. `familyUtils.js` has zero
  external imports so it's import-safe in plain Node; `naturalQuery.js` also
  pulls in `src/lib/firebase.js`, so a throwaway script importing it must end
  with `process.exit(0)` or Firebase's keep-alive holds the process open. So:
  ```js
  import { getRelationshipLabelTamil } from 'file:///C:/absolute/path/to/src/utils/familyUtils.js';
  // build a synthetic `persons` object, call the function, console.log and eyeball it
  ```
  Keep these scripts around (in the session scratchpad) and re-run the
  accumulated set after any engine change. Don't delete them as "cleanup."
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
- **Any logic keyed off `Object.keys(persons)` or a `Map`/`Set` built from
  it inherits Firestore's field-order non-guarantee** (see the bullet above
  about signatures) — this isn't just a `JSON.stringify` gotcha. `getForestRoots`
  picking a top couple's canonical root by checking only ONE spouse's own
  `childrenIds` to find their connecting descendant looked fine in isolation,
  but when that array was asymmetric (a real, separate data bug — a child
  recorded under one parent but not the other), the result silently depended
  on which spouse Firestore happened to list first, so the exact same data
  could produce a different "Generation" number in Family Statistics on
  every reload. Fixed by checking both spouses' arrays together — but the
  general lesson is: any tie-break or "pick one of several equally-valid
  candidates" logic over `persons` needs an explicit, data-independent
  tie-break (alphabetical by id, etc.), not "whichever came first."
- **A fallback that inherits a relative's already-computed term must
  re-derive the correctly-gendered word for the person INHERITING it, not
  copy the term verbatim.** `resolveTamilTermChained`/`resolveEnglishTermChained`'s
  sibling-inheritance fallback (someone with no direct relationship of their
  own, related only via being their sibling's sibling) used to return the
  sibling's own term as-is — so a man whose only connection to the tree was
  being the brother of a woman married to a cross-cousin inherited her
  feminine term (தங்கை / "1st Cousin's Wife") unchanged. Fixed via
  `SIBLING_TERM_GENDER_PAIRS` (Tamil) and `ENGLISH_SIBLING_GENDER_PAIRS`
  (English, restricted to plain symmetric words only — a compound phrase
  like "1st Cousin's Wife" has no real English equivalent for a different
  person, so it now correctly returns nothing rather than a wrong phrase).
  Same lesson applies to `tamilCrossCousinSpouseTerm`, which used to infer a
  spouse's gender from their cross-cousin's gender instead of checking the
  spouse's own recorded gender — always prefer the actual person's own
  `gender` field over inferring it from someone else's.
- **Transactional-email free tiers vary wildly in whether they need a verified
  domain — always test a real send to a SECOND address before trusting a
  provider's marketing copy.** Resend was tried first specifically because it
  claims its shared sandbox sender needs no domain setup — true for sending
  to yourself, but it hard-rejects (`403 validation_error`) every OTHER
  recipient until a domain is verified, discovered only by an actual test
  send, not by reading their docs. Switched to **Brevo** instead
  (`worker/src/email.js`), which supports verifying a single sender EMAIL
  (no domain) via **Senders, Domains & Dedicated IPs → Senders → Add Sender**
  in its dashboard, and — confirmed by testing, not assumed — actually
  delivers to arbitrary recipients from that single verified address. Brevo
  does warn that a plain Gmail/freemail sender lacks the DKIM/DMARC alignment
  Google/Yahoo/Microsoft now recommend (may affect spam-folder placement),
  but this is advisory, not a hard block like Resend's. If deliverability
  becomes a real problem later, the fix is a verified custom domain — the
  user doesn't currently own one, so this was deliberately deferred.
  Free-tier scale: Brevo is 300 emails/day, permanent (unlike SendGrid, whose
  once-permanent free tier is now a 60-day trial only — checked live during
  this decision, not from memory, since exactly this kind of policy changes
  over time).
- **The birthday-alert email job has NO per-account opt-in, on purpose.** A
  `NotificationPreferences.jsx` panel with a personal "email me about
  birthdays" toggle existed briefly and was deliberately deleted — once the
  panel got admin-gated (so regular family members couldn't reach it
  anyway), the user explicitly chose "broadcast to every signed-in account"
  over "opt-in, but only the admin can actually opt anyone in." The only
  control now is the single admin-only master switch in Admin Settings
  (`settings/app.features.birthdayAlertEmails`, off by default). Don't
  reintroduce a personal opt-in field without checking this was actually
  wanted back — it was removed as dead weight, not lost by accident.
- **A Grep-tool display quirk**: search results have occasionally rendered
  `//` (a real comment marker in the file) as a stray `\` in this
  environment. If a Grep result shows something like `\ Fallback #3:` where
  a `//` comment would make more sense, re-read the file directly with the
  Read tool before assuming the file is actually broken — it usually isn't.
- **The Ask panel now WRITES, not just reads — but only through one narrow,
  local path.** "add X as son of Y" (and a few phrasings of it) creates a
  person via the existing `addChild`/`addSpouse`/`addParent`/`addSibling`
  mutations. Two rules keep this safe and must not be "simplified" away:
  (1) the add command is detected by strict local regex (`parseAddCommand`)
  and short-circuited at the TOP of both `parseQuery` AND `parseQueryAI` so it
  is **never sent to the AI Worker** — an older/mis-guessing model must not be
  able to turn a write into some other intent; (2) it only ever writes after
  an explicit on-screen confirm (the `add-confirm` → `add-done` result kinds
  in `AskPanel.jsx`), never straight out of parsing. The Worker's own
  `add-person` shape exists purely as a future-proof backup and is not the
  live path. Same "answering/parsing stays local, AI only classifies" rule as
  the read queries — don't blur it for writes either.
- **Relationship-term editing is admin-only, and the Relationship Rules panel
  lives under Admin Settings**, not on a public header/mobile-menu button
  anymore. The pencil on a person's relationship badge renders only when
  `onEditRelationship` is passed, and App.jsx passes it as
  `isAdmin ? handleEditRelationship : undefined` — so the gating is at the
  prop, not inside PersonDetail. Don't re-add a public entry point to
  Relationship Rules without checking this was a deliberate admin-only move.
- **The chained relationship resolvers are memoized per-node on purpose — do
  not remove it.** `getRelationshipLabel`/`getRelationshipLabelTamil` had an
  exponential blow-up (one distant pair measured at ~21,000ms; building the
  whole relation list froze the tab). The fix was per-node memoization inside
  the chained resolvers in `familyUtils.js` (~21,000ms → single-digit ms).
  If you refactor those resolvers, keep the memoization — a "cleaner" naive
  recursion reintroduces the freeze.

## Secrets and credentials

- **Firebase web config** (`src/lib/firebase.js`) is intentionally public —
  these are client identifiers, not secrets. Don't treat them as sensitive.
- **Groq API key** lives only in Cloudflare's secret store (`wrangler secret
  put GROQ_API_KEY`), never in any committed file. If you ever see it in
  plaintext anywhere (chat, a file, a log), treat that as a rotation event.
- **Firebase service account** (`FIREBASE_SERVICE_ACCOUNT` GitHub secret)
  and **Cloudflare account access** are the two credentials with real
  blast radius in this project — don't request or handle these casually.
  A plaintext copy has shown up locally in the user's Downloads folder more
  than once (`family-tree-*-firebase-adminsdk-*.json`) — if you spot it,
  mention it's worth moving somewhere more secure, but don't move/delete it
  yourself without being asked. If asked to use it for a direct Firestore
  write (see SKILLS.md's "Bulk-edit live Firestore data directly"), remember
  it bypasses the app's own Undo history entirely — get explicit
  confirmation of the exact change set before writing, not just permission
  to use the credential in general.
- Never suggest routing around the Blaze-plan constraint by just paying for
  it without asking first — the user has consistently preferred staying on
  free tiers and re-architecting (Cloudflare instead of Firebase Functions)
  to do so. Surface the tradeoff; let them decide.
- **A `.env` file at the repo root holds a live WhatsApp Graph API access
  token** (`whatsapp_token=...`) — real and usable, not a placeholder. It's
  gitignored (added after the fact — it was untracked but NOT ignored when
  first noticed, so double-check it's still listed in `.gitignore` if that
  file is ever restructured) and was never committed. Nothing in `src/` or
  `worker/` reads this file — it exists purely from manual `curl` testing
  in Meta's Graph API Explorer, not app code. Treat it the same as any other
  API key: if it surfaces in plaintext (chat, a log), it's a rotation event.

## WhatsApp Business API — explored, not adopted

A Meta app ("Family Tree Mani App") with the WhatsApp Business Platform was
registered and successfully tested (free-form `curl` messages sent via
`graph.facebook.com/v25.0/{phone-number-id}/messages`, confirmed delivered).
Two uses were considered and explicitly **not** pursued for this app:

- **WhatsApp-based OTP login**, as an alternative/addition to Google
  Sign-In. Rejected: Google Sign-In already works for everyone; WhatsApp
  OTP doesn't plug into Firebase Auth as a built-in provider (Firebase's own
  Phone Auth needs the paid Blaze plan, and this would be a different,
  from-scratch mechanism anyway — generate/store/verify OTP codes, then mint
  a Firebase custom token) — a real new backend subsystem to replace
  something that isn't broken.
- **WhatsApp birthday-reminder messages**, as an alternative/addition to the
  email job (see the Brevo section above). Rejected on cost grounds: a
  birthday message is business-initiated (nobody messaged the account that
  day), and Meta retired its free monthly conversation allowance on
  **July 1, 2025** — confirmed live during this decision, not assumed, since
  the user specifically recalled the old "1,000 free messages" policy and it
  needed checking, not just correcting from memory. There is now no free
  tier for this kind of outbound message at all; it would have been this
  project's first genuine recurring cost, unlike every other integration
  here (Cloudflare, Groq, Brevo, GCP read-only service account) which are
  all free at this app's scale.

Both rejections were the user's own call after the tradeoffs were laid out —
if WhatsApp comes up again, these are already-considered-and-declined paths,
not unexplored ideas; check with the user before re-proposing either without
new information (e.g. a specific reported pain point with Google Sign-In).

Separately: the WhatsApp Business Platform's **free tier only sends to up to
5 pre-verified test recipient numbers** — reaching real family members at
scale would require Meta business verification and a production phone
number regardless of which use case it's for.

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
- For a data fix affecting many people identified by name, will choose the
  faster "direct Admin SDK write" path over the safer "Export JSON → edit →
  Import" path when explicitly offered the choice — but still wants the full
  resolved name→person mapping shown and confirmed before anything is
  actually written, especially where a name required fuzzy-matching or a
  spouse lookup (several people are recorded under a married-in surname).
- When a UI/relationship bug is reported from a screenshot, don't assume
  the first plausible-looking cause is right — verify against the live data
  itself (export or an Admin SDK read) rather than reasoning from a
  synthetic test case alone. Two bugs this session were initially
  misdiagnosed from code-reading alone (the wrong person's gender field
  blamed for a "Wife"/தங்கை mislabel; a "should be Generation III" report
  that turned out to be a completely different order-dependency bug) and
  only found by actually pulling the real records.
