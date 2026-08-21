// Plain-English question answering over the family tree. The ANSWERING half
// (this file's resolveAnswer/relationship lookups) always stays local — it
// reuses the existing relationship engine (getRelationshipLabel/
// getRelationshipLabelTamil/getRelationshipPath) and never calls out anywhere,
// so it's free and every family member's actual data never leaves the
// browser. The PARSING half (turning a freely-worded question into a
// {type, nameA/nameB/name, relationWord} intent) has two paths:
//   - parseQuery: a fixed set of regex patterns, entirely local, always
//     available, but only understands a handful of fixed phrasings.
//   - parseQueryAI: sends ONLY the question text (never any family data) to
//     a small Cloudflare Worker proxy (see worker/src/index.js) that asks a
//     free-tier Groq LLM to extract the same intent shape, understanding far
//     more phrasings. The Worker (not Firebase Cloud Functions — those
//     require the paid Blaze plan just to make an outbound call to a non-
//     Google API) verifies the caller's Firebase ID token before forwarding
//     anything to Groq, so the shared free-tier quota can't be drained by a
//     stranger who finds the URL. Falls back to parseQuery automatically if
//     the Worker is unreachable, not yet deployed, or the quota is exhausted
//     — the feature never fully breaks without it.
import { auth } from '../lib/firebase.js';
import {
  getDaysUntilBirthday,
  getDisplayName,
  getRelationshipLabel,
  getRelationshipLabelTamil,
  getRelationshipPath,
} from './familyUtils.js';

const ASK_WORKER_URL = 'https://family-tree-ask-worker.manikandan-ks-14.workers.dev';

// English plurals that don't just drop a trailing "s" (a naive strip would
// leave "children"/"grandchildren" unmatched against the engine's singular
// "Child"/"Grandchild" labels).
const IRREGULAR_SINGULAR = {
  children: 'child',
  grandchildren: 'grandchild',
  wives: 'wife',
};

function singularize(word) {
  const w = word.trim().toLowerCase();
  if (IRREGULAR_SINGULAR[w]) return IRREGULAR_SINGULAR[w];
  if (w.endsWith('ies') && w.length > 3) return `${w.slice(0, -3)}y`;
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

// Several everyday relation words have no single matching English label at
// all — the engine's own labels are gendered ("Son"/"Daughter", never the
// generic "Child") for anyone whose gender is known, so a literal word-match
// on "child" would silently return zero results for "who are X's children".
// Expands to every gendered variant the engine actually produces; categories
// not listed here (Cousin, Uncle, Aunt, Nephew, Niece, ...) already ARE the
// literal word used, so they need no expansion.
const RELATION_GROUPS = {
  child: ['son', 'daughter', 'child'],
  sibling: ['brother', 'sister', 'sibling'],
  parent: ['father', 'mother', 'parent'],
  grandchild: ['grandson', 'granddaughter', 'grandchild'],
  grandparent: ['grandfather', 'grandmother', 'grandparent'],
};

// Word-boundary match, not substring — a substring check for "father" would
// also light up on "Grandfather"/"Great-Grandfather", which is wrong.
function labelMatchesRelation(label, relationWord) {
  // "brother" must not match "Brother-in-law" (the hyphen is a \b boundary) —
  // only match an in-law label when the question itself asked for an in-law.
  const wantsInLaw = /in[-\s]?law/i.test(relationWord);
  if (/in[-\s]?law/i.test(label) && !wantsInLaw) return false;
  const singular = singularize(relationWord);
  if (!singular) return false;
  const words = RELATION_GROUPS[singular] || [singular];
  return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(label));
}

// "Who are MY cousins?" / "how is X related to ME?" — neither parser (local
// regex or the AI classifier) has any way to know who "my"/"me" refers to,
// since that's the signed-in user's own identity, not something in the
// question text itself. Substituting it for their actual first name up front
// turns it into an ordinary named question ("who are Manikandan's cousins?")
// that flows through the existing pipeline unchanged — done here, once, so
// both parseQuery and parseQueryAI benefit without either needing to know
// about "self" as a concept. Word-boundary matched so this never touches an
// unrelated word containing "my"/"me" (e.g. "Amy", "Meena").
export function substituteSelfReferences(text, selfName) {
  if (!selfName) return text;
  return text.replace(/\bmy\b/gi, `${selfName}'s`).replace(/\bme\b/gi, selfName);
}

// --- Attribute / list / count queries -------------------------------------
// Answers "who <matches a recorded field>" and "how many" questions (jobs,
// places, gender, living/deceased, birth year, name). Like every other answer
// in this file it's computed 100% locally from the persons map — the AI (or the
// local patterns below) only ever CLASSIFY the question into a {field, value,
// aggregate} shape; no person's data is ever sent anywhere. Phone/email are
// deliberately NOT searchable fields, so contact details never enter any prompt.
const ATTRIBUTE_FIELDS = new Set(['work', 'location', 'gender', 'status', 'birthYear', 'name', 'any', 'all']);

// Lenient text match: a plain substring hit, or every (roughly de-pluralised)
// query word appearing in the stored value — so "software engineers" still
// matches a stored "Software Engineer".
function textFieldMatch(stored, value) {
  const s = (stored || '').toLowerCase();
  const v = (value || '').trim().toLowerCase();
  if (!s || !v) return false;
  if (s.includes(v)) return true;
  const words = v.split(/\s+/).map((w) => w.replace(/s$/i, '')).filter(Boolean);
  return words.length > 0 && words.every((w) => s.includes(w));
}

function personMatchesAttribute(person, field, value) {
  const v = (value || '').trim().toLowerCase();
  switch (field) {
    case 'work': return textFieldMatch(person.work, value);
    case 'location': return textFieldMatch(person.location, value);
    case 'name': return textFieldMatch(getDisplayName(person), value);
    // Free-text catch-all for vague questions ("who is a teacher") — searches
    // the recorded free-text fields only; phone/email are never searched.
    case 'any':
      return textFieldMatch(person.work, value)
        || textFieldMatch(person.location, value)
        || textFieldMatch(person.notes, value)
        || textFieldMatch(getDisplayName(person), value);
    case 'gender':
      if (/^(m|male|males|men|man|boys?|gents?|guys?)$/.test(v)) return person.gender === 'male';
      if (/^(f|female|females|women|woman|girls?|ladies|lady)$/.test(v)) return person.gender === 'female';
      return person.gender === v;
    case 'status':
      if (/aliv|living/.test(v)) return person.isAlive !== false;
      if (/deceas|dead|passed|died|late|expired|gone/.test(v)) return person.isAlive === false;
      return false;
    case 'birthYear': return !!person.dob && person.dob.slice(0, 4) === v.replace(/\D/g, '');
    default: return false;
  }
}

// One-line summary shown above the matched list (or standing alone for a count).
function describeAttribute(field, value, count) {
  const n = count === 1 ? '1 person' : `${count} people`;
  const val = (value || '').trim();
  const some = count > 0;
  switch (field) {
    case 'all': return `There ${count === 1 ? 'is' : 'are'} ${n} in the tree.`;
    case 'work': return some ? `${n} recorded as "${val}":` : `No one is recorded working as "${val}".`;
    case 'location': return some ? `${n} recorded in ${val}:` : `No one is recorded as being in "${val}".`;
    case 'name': return some ? `${n} matching "${val}":` : `No one matches the name "${val}".`;
    case 'any': return some ? `${n} matching "${val}":` : `No one matches "${val}".`;
    case 'birthYear': return some ? `${n} born in ${val}:` : `No one is recorded as born in ${val}.`;
    case 'gender': {
      const male = /^(m|male|males|men|man|boys?|gents?|guys?)$/.test(val.toLowerCase());
      const label = male ? 'male' : 'female';
      return some ? `${n} recorded as ${label}:` : `No one is recorded as ${label}.`;
    }
    case 'status': {
      const alive = /aliv|living/.test(val.toLowerCase());
      return some ? `${n} ${alive ? 'currently living' : 'no longer with us'}:` : `No one is recorded as ${alive ? 'living' : 'deceased'}.`;
    }
    default: return some ? `${n}:` : 'No matches.';
  }
}

const cleanAttrValue = (s) => (s || '').trim().replace(/^(?:an?|the|all)\s+/i, '').replace(/[?.!,]+$/, '').trim();

// --- Add-a-person commands -------------------------------------------------
// Turns "add <name> as <relation> of <existing person>" (and a few phrasings
// of it) into an {type:'add-person', action, gender, name, target} intent. This
// is the ONE query type that WRITES, so unlike every question above it is
// detected strictly and ENTIRELY locally — never handed to the AI Worker
// (see parseQueryAI) — so an "add" command can't be silently misrouted into,
// say, a relation-list lookup by an older/mis-guessing model. The relation
// word both picks which existing mutation runs (addChild/addSpouse/addParent/
// addSibling) and, where the word is gendered, seeds the new person's gender;
// generic words (child/parent/sibling/spouse) leave gender unset for the user
// to fill in. The actual write only happens after an explicit on-screen
// confirm (see AskPanel), never straight from parsing.
const ADD_RELATIONS = {
  son: { action: 'child', gender: 'male' },
  daughter: { action: 'child', gender: 'female' },
  child: { action: 'child', gender: null },
  kid: { action: 'child', gender: null },
  father: { action: 'parent', gender: 'male' },
  dad: { action: 'parent', gender: 'male' },
  mother: { action: 'parent', gender: 'female' },
  mom: { action: 'parent', gender: 'female' },
  mum: { action: 'parent', gender: 'female' },
  parent: { action: 'parent', gender: null },
  brother: { action: 'sibling', gender: 'male' },
  sister: { action: 'sibling', gender: 'female' },
  sibling: { action: 'sibling', gender: null },
  husband: { action: 'spouse', gender: 'male' },
  wife: { action: 'spouse', gender: 'female' },
  spouse: { action: 'spouse', gender: null },
  partner: { action: 'spouse', gender: null },
};

const stripNamey = (s) => (s || '').trim().replace(/^(?:an?|the)\s+/i, '').replace(/[?.!,]+$/, '').trim();

function buildAddIntent(name, relationWord, target) {
  const rel = ADD_RELATIONS[singularize((relationWord || '').trim())];
  if (!rel) return null;
  const cleanName = stripNamey(name);
  const cleanTarget = stripNamey(target);
  if (!cleanName || !cleanTarget) return null;
  return { type: 'add-person', name: cleanName, relationWord: singularize(relationWord.trim()), target: cleanTarget, action: rel.action, gender: rel.gender };
}

// Only fires on an explicit leading add/create verb, so it never swallows a
// QUESTION that merely contains a relation word ("who are Kumar's sons").
export function parseAddCommand(raw) {
  const text = (raw || '').trim().replace(/[‘’]/g, "'").replace(/[?!.]+$/, '').trim();
  if (!/^(?:add|create|new|insert|register)\b/i.test(text)) return null;
  const body = text.replace(/^(?:add|create|new|insert|register)\s+/i, '').trim();

  // "<name> as <target>'s <relation>"  — "Ravi as Kumar's son"
  let m = /^(.+?)\s+as\s+(.+?)'s\s+(.+)$/i.exec(body);
  if (m) return buildAddIntent(m[1], m[3], m[2]);

  // "<name> as (a|the)? <relation> (of|to|for) <target>"  — "Ravi as son of Kumar"
  m = /^(.+?)\s+as\s+(?:an?\s+|the\s+)?(.+?)\s+(?:of|to|for)\s+(.+)$/i.exec(body);
  if (m) return buildAddIntent(m[1], m[2], m[3]);

  // "(a|the)? <relation> (named|called)? <name> (to|for|of|under) <target>"
  //   — "a son named Ravi to Kumar" / "daughter Priya for Meena"
  m = /^(?:an?\s+|the\s+)?(\w+)\s+(?:named\s+|called\s+)?(.+?)\s+(?:to|for|of|under)\s+(.+)$/i.exec(body);
  if (m && ADD_RELATIONS[singularize(m[1])]) return buildAddIntent(m[2], m[1], m[3]);

  // "<target>'s <relation> <name>"  — "Kumar's wife Latha"
  m = /^(.+?)'s\s+(\w+)\s+(.+)$/i.exec(body);
  if (m && ADD_RELATIONS[singularize(m[2])]) return buildAddIntent(m[3], m[2], m[1]);

  return null;
}

// A clear ADD intent that's missing the name and/or the person to attach to
// ("add a new person", "add someone", a bare "add") — so we can guide the user
// to the full phrasing instead of dropping them into the generic help text.
function looksLikeAddAttempt(raw) {
  const text = (raw || '').trim();
  return /^(?:add|create|new|insert|register)\b/i.test(text)
    || /\badd\s+(?:a\s+)?(?:new\s+)?(?:person|member|someone|somebody|relative|people)\b/i.test(text);
}

// --- Edit-an-existing-person commands --------------------------------------
// The OTHER write intents (beyond add-person): set a field, mark deceased/alive,
// or record a marriage between two existing people. Like add-person these are
// detected by strict LOCAL regex, never routed to the AI, and only ever write
// after an on-screen confirm (see AskPanel's edit-confirm/edit-done). A subject
// that reads like a question opener (who/how many/…) is rejected so a lookup is
// never mistaken for a command.
const QUESTION_OPENER = /^(?:who|whos|whose|what|which|when|where|how|is\s+there|are\s+there|anyone|anybody|everyone|everybody|somebody|someone|people|list|show|find|name|does|do|did|can|could)\b/i;

const EDIT_FIELDS = {
  job: 'work', 'job title': 'work', work: 'work', occupation: 'work', profession: 'work',
  location: 'location', place: 'location', home: 'location', city: 'location', town: 'location', address: 'location', residence: 'location',
  phone: 'phone', mobile: 'phone', number: 'phone', 'phone number': 'phone',
  email: 'email', 'email address': 'email', mail: 'email',
  note: 'notes', notes: 'notes',
  dob: 'dob', birthday: 'dob', born: 'dob', birthdate: 'dob', 'birth date': 'dob', 'date of birth': 'dob',
};

const EDIT_FIELD_LABEL = { work: 'job', location: 'location', phone: 'phone number', email: 'email', notes: 'notes', dob: 'date of birth' };

const MONTHS_FULL = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad2 = (n) => String(Number(n)).padStart(2, '0');

// Parses a human-typed date to the app's ISO-ish shape ("YYYY-MM-DD" | "YYYY-MM"
// | "YYYY"). Day-first for numeric slashes (Indian convention). '' if unreadable.
export function parseHumanDate(raw) {
  const s = (raw || '').trim().toLowerCase().replace(/(\d+)(?:st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  let m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(s);
  if (m) return m[3] && m[2] ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : m[2] ? `${m[1]}-${pad2(m[2])}` : m[1];
  m = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/.exec(s);
  if (m && MONTHS_FULL[m[2]]) return `${m[3]}-${pad2(MONTHS_FULL[m[2]])}-${pad2(m[1])}`;
  m = /^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/.exec(s);
  if (m && MONTHS_FULL[m[1]]) return `${m[3]}-${pad2(MONTHS_FULL[m[1]])}-${pad2(m[2])}`;
  m = /^([a-z]+)\s+(\d{4})$/.exec(s);
  if (m && MONTHS_FULL[m[1]]) return `${m[2]}-${pad2(MONTHS_FULL[m[1]])}`;
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
  return '';
}

const cleanName = (s) => (s || '').trim().replace(/[?.!,]+$/, '').trim();

function buildSetField(name, field, value) {
  const n = cleanName(name);
  let v = (value || '').trim().replace(/[?.!,]+$/, '').trim();
  if (!n || !v) return null;
  if (field === 'dob') {
    const iso = parseHumanDate(v);
    return { type: 'edit-person', op: 'set-field', name: n, field, value: iso, badDate: !iso };
  }
  return { type: 'edit-person', op: 'set-field', name: n, field, value: v };
}

export function parseEditCommand(raw) {
  const text = (raw || '').trim().replace(/[‘’]/g, "'").replace(/[?!.]+$/, '').trim();
  if (!text) return null;

  // "X married Y [on/in <date>]" / "mark X married to Y"
  let m = /^(?:mark\s+)?(.+?)\s+(?:married|is\s+married\s+to|got\s+married\s+to|wed|wedded)\s+(.+?)(?:\s+(?:on|in)\s+(.+))?$/i.exec(text);
  if (m && !QUESTION_OPENER.test(m[1].trim())) {
    const nameA = cleanName(m[1]);
    const nameB = cleanName(m[2]);
    if (nameA && nameB) return { type: 'edit-person', op: 'set-married', nameA, nameB, date: parseHumanDate(m[3] || '') };
  }

  // Deceased
  m = /^mark\s+(.+?)\s+as\s+(?:deceased|dead|late|no\s+longer\s+(?:with\s+us|alive|living))$/i.exec(text)
    || /^(.+?)\s+(?:has\s+)?(?:passed\s+away|passed\s+on|is\s+deceased|is\s+dead|is\s+late|is\s+no\s+longer\s+with\s+us|died|expired)(?:\s+(?:on|in)\s+(.+))?$/i.exec(text);
  if (m && !QUESTION_OPENER.test(m[1].trim())) {
    return { type: 'edit-person', op: 'mark-deceased', name: cleanName(m[1]), date: parseHumanDate(m[2] || '') };
  }

  // Alive
  m = /^mark\s+(.+?)\s+as\s+(?:alive|living|not\s+deceased)$/i.exec(text)
    || /^(.+?)\s+is\s+(?:alive|living|still\s+alive|still\s+living)$/i.exec(text);
  if (m && !QUESTION_OPENER.test(m[1].trim())) {
    return { type: 'edit-person', op: 'mark-alive', name: cleanName(m[1]) };
  }

  // Explicit "set/change/update X's <field> to <value>"
  m = /^(?:set|change|update)\s+(.+?)(?:'s)?\s+(job\s+title|date\s+of\s+birth|birth\s*date|phone\s+number|email\s+address|job|work|occupation|profession|location|place|home|city|town|address|residence|phone|mobile|number|email|mail|notes?|dob|birthday|born|birthdate)\s+(?:to|as|=|:)\s+(.+)$/i.exec(text);
  if (m) {
    const field = EDIT_FIELDS[m[2].trim().toLowerCase().replace(/\s+/g, ' ')];
    if (field) return buildSetField(m[1], field, m[3]);
  }

  // Natural statements with a named subject
  m = /^(.+?)\s+(?:lives?|stays?|resides?|is\s+based)\s+(?:in|at|near)\s+(.+)$/i.exec(text);
  if (m && !QUESTION_OPENER.test(m[1].trim())) return buildSetField(m[1], 'location', m[2]);

  m = /^(.+?)\s+works?\s+as\s+(?:an?\s+)?(.+)$/i.exec(text);
  if (m && !QUESTION_OPENER.test(m[1].trim())) return buildSetField(m[1], 'work', m[2]);

  return null;
}

// Best-effort LOCAL classifier for attribute/count questions — the AI Worker
// understands far more phrasings; this is the offline/fallback path. Returns
// null when nothing matches, so parseQuery falls through to 'unknown'.
function parseAttributeQuery(text) {
  const isCount = /^\s*how\s+many\b/i.test(text);

  let m = /\b(?:works?|working|employed)\s+as\s+(?:an?\s+)?(.+)$/i.exec(text)
    || /\b(?:job|profession|occupation)\s+(?:is|as)\s+(?:an?\s+)?(.+)$/i.exec(text);
  if (m) return { type: 'attribute-query', field: 'work', value: cleanAttrValue(m[1]), aggregate: isCount };

  // "works/working in/at/for/with <X>" is an employer/place, not a job title —
  // search it across job/place/notes (field 'any') so "who works at Hyundai" or
  // "working in IT" matches a recorded job of "Engineer - Hyundai".
  m = /\b(?:work(?:s|ing)?|employed)\s+(?:at|for|with|in|by)\s+(.+)$/i.exec(text);
  if (m) return { type: 'attribute-query', field: 'any', value: cleanAttrValue(m[1]), aggregate: isCount };

  m = /\b(?:lives?|living|stays?|staying|resides?|based)\s+(?:in|at|near)\s+(.+)$/i.exec(text)
    || /\b(?:is|are|come|comes|hail|hails)\s+from\s+(.+)$/i.exec(text)
    || /\b(?:who(?:'s| is| are)?|anyone|people|everyone|members?)\s+(?:in|at|near|from)\s+(.+)$/i.exec(text);
  if (m) return { type: 'attribute-query', field: 'location', value: cleanAttrValue(m[1]), aggregate: isCount };

  m = /\bborn\s+(?:in\s+)?(\d{4})\b/i.exec(text);
  if (m) return { type: 'attribute-query', field: 'birthYear', value: m[1], aggregate: isCount };

  m = /\b(?:named|called)\s+(.+)$/i.exec(text);
  if (m) return { type: 'attribute-query', field: 'name', value: cleanAttrValue(m[1]), aggregate: isCount };

  const opener = /^(?:who\b|how\s+many\b|list\b|show\b|find\b|name\b|any\b|anyone\b|is\s+there\b)/i.test(text);
  if (!opener) return null;

  if (/\b(males?|men|man|boys?|gents?)\b/i.test(text)) return { type: 'attribute-query', field: 'gender', value: 'male', aggregate: isCount };
  if (/\b(females?|women|woman|girls?|ladies|lady)\b/i.test(text)) return { type: 'attribute-query', field: 'gender', value: 'female', aggregate: isCount };
  if (/\b(deceased|passed\s+away|no\s+longer|dead|late|expired)\b/i.test(text)) return { type: 'attribute-query', field: 'status', value: 'deceased', aggregate: isCount };
  if (/\b(alive|living|still\s+with\s+us)\b/i.test(text)) return { type: 'attribute-query', field: 'status', value: 'alive', aggregate: isCount };

  if (isCount && /\b(people|members|persons|relatives|everyone|in\s+(?:the|this)\s+(?:tree|family))\b/i.test(text)) {
    return { type: 'attribute-query', field: 'all', value: '', aggregate: true };
  }

  // Last resort: "who is a <X>", "any <X>", "how many <X>", "list <X>" — treat X
  // as a free-text keyword matched across job/place/notes/name, so "who is a
  // teacher" or "any engineers" work without a fixed job/role list.
  m = /^(?:who(?:'s| is| are| were)?|anyone|any|is\s+there|how\s+many|list|show(?:\s+me)?|find|name)\s+(?:the\s+)?(?:an?\s+)?(.+)$/i.exec(text);
  if (m) {
    const val = cleanAttrValue(m[1]);
    if (val.length >= 3) return { type: 'attribute-query', field: 'any', value: val, aggregate: isCount };
  }
  return null;
}

// Recognizes a small, fixed set of question phrasings — checked in an order
// where more specific patterns (requiring "related to"/"relationship") come
// before the generic possessive/`"of"` fallbacks, so e.g. "how is X related to
// Y" is never misread as a possessive query just because it also contains "is".
export function parseQuery(raw) {
  const text = (raw || '')
    .trim()
    // Mobile keyboards often auto-curl a straight apostrophe, and a fumbled
    // possessive ("Manikandan'ss") is common enough to normalize outright
    // rather than reject — both would otherwise silently fall through every
    // pattern below to "I didn't understand that", reading as the whole
    // feature being broken over a single stray character.
    .replace(/[‘’]/g, "'")
    .replace(/'s+\b/gi, "'s")
    .replace(/[?!.]+$/, '')
    .trim();
  if (!text) return { type: 'empty' };

  // A question ABOUT the tool itself, not about a relationship in the tree —
  // checked before anything else so "help" or "hi" doesn't fall through to a
  // relation-list match on a leftover "'s" pattern by accident. Kept as a
  // small fixed list (not the AI classifier's job here) so this still works
  // even when parseQueryAI can't reach the Worker at all.
  if (/^(hi|hey|hello|help|what can you do|what do you do|what is this)$/i.test(text)) {
    return { type: 'meta' };
  }

  // "Whose birthday is coming next?" / "who has the next birthday?" /
  // "upcoming birthdays" — no name to extract, just a category of question,
  // so a single broad keyword match covers this rather than an exhaustive
  // phrasing list like the relation types need.
  if (/\bbirthdays?\b/i.test(text) && /\b(next|upcoming|soon|coming)\b/i.test(text)) {
    return { type: 'birthday-next' };
  }

  // An add/create command is the only WRITE intent — detected before every
  // question pattern so "add X as son of Y" is never misread as a lookup.
  const addCmd = parseAddCommand(text);
  if (addCmd) return addCmd;
  // A clear-but-incomplete add ("add a new person") gets its own guidance
  // rather than falling through to the generic "didn't understand" help.
  if (looksLikeAddAttempt(text)) return { type: 'add-incomplete' };

  // Other write commands (set a field, mark deceased/married) — also before the
  // question patterns, so "set X's job to Y" isn't misread as a possessive lookup.
  const editCmd = parseEditCommand(text);
  if (editCmd) return editCmd;

  let m = /^how\s+(?:is|are)\s+(.+?)\s+related\s+to\s+(.+)$/i.exec(text);
  if (m) return { type: 'relation-between', nameA: m[1], nameB: m[2] };

  m = /^how\s+(?:is|are)\s+(.+?)\s+and\s+(.+?)\s+related$/i.exec(text);
  if (m) return { type: 'relation-between', nameA: m[1], nameB: m[2] };

  m = /(?:relationship|connection)\s+(?:between|of)\s+(.+?)\s+and\s+(.+)$/i.exec(text);
  if (m) return { type: 'relation-between', nameA: m[1], nameB: m[2] };

  m = /^what\s+(?:is|are|was)\s+(.+?)\s+to\s+(.+)$/i.exec(text);
  if (m) return { type: 'relation-between', nameA: m[1], nameB: m[2] };

  // "who is X married to" — a spouse lookup phrased as a question, resolved via
  // the same spouse relation-list path as "who is X's wife/husband".
  m = /^who\s+(?:is|are)\s+(.+?)\s+married\s+to$/i.exec(text);
  if (m) return { type: 'relation-list', name: m[1], relationWord: 'spouse' };

  // Possessive form: "who are X's cousins" / "who is X's father" / "list X's
  // children" / "show X's siblings" — also matches the bare "X's cousins"
  // without a leading question word, for a quicker/terser query style.
  m = /^(?:who\s+(?:is|are)|list|show(?:\s+me)?)?\s*(.+?)'s\s+(.+)$/i.exec(text);
  if (m && m[1].trim()) return { type: 'relation-list', name: m[1], relationWord: m[2] };

  // Reversed form: "cousins of X" / "who are the children of X" — requires an
  // explicit question opener, unlike the possessive fallback above, since a
  // bare "<word> of <word>" pattern is too generic to safely guess at otherwise.
  m = /^(?:who\s+(?:is|are)|list|show(?:\s+me)?)\s+(?:the\s+)?(.+?)\s+of\s+(.+)$/i.exec(text);
  if (m) return { type: 'relation-list', name: m[2], relationWord: m[1] };

  const attr = parseAttributeQuery(text);
  if (attr) return attr;

  return { type: 'unknown' };
}

// AI-assisted parsing — sends ONLY the question text (never any family data)
// to the Cloudflare Worker (worker/src/index.js), which asks a free-tier LLM
// to extract the same intent shape parseQuery produces locally, but
// understands far more phrasings than a fixed set of regexes ever could.
// Falls back to parseQuery automatically on ANY failure (Worker not deployed
// yet, signed out, no network, quota exhausted, malformed response) — the
// feature degrades to the local parser rather than breaking outright.
const AI_TIMEOUT_MS = 9000;

// Races an arbitrary promise chain against a hard deadline. AbortSignal only
// bounds the ONE fetch() it's passed to — it was previously attached solely
// to the Worker request, but auth.currentUser.getIdToken() runs BEFORE that
// (and can itself do a network round-trip to silently refresh an expiring
// token) with nothing bounding it at all, so a stall there hung the whole
// panel on "Thinking…" forever regardless of the fetch-level fix. Wrapping
// the entire attempt — token fetch, network call, and response parsing —
// guarantees parseQueryAI always settles within AI_TIMEOUT_MS no matter
// which step actually stalls.
function withDeadline(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

async function callAskWorker(text) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in.');
  const res = await fetch(ASK_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ question: text }),
  });
  if (!res.ok) throw new Error(`Worker responded ${res.status}`);
  const data = await res.json();
  if (data?.type === 'relation-between' && data.nameA && data.nameB) {
    return { type: 'relation-between', nameA: data.nameA, nameB: data.nameB };
  }
  if (data?.type === 'relation-list' && data.name && data.relationWord) {
    return { type: 'relation-list', name: data.name, relationWord: data.relationWord };
  }
  if (data?.type === 'meta') return { type: 'meta' };
  if (data?.type === 'birthday-next') return { type: 'birthday-next' };
  if (data?.type === 'attribute-query' && typeof data.field === 'string') {
    return { type: 'attribute-query', field: data.field, value: typeof data.value === 'string' ? data.value : '', aggregate: !!data.aggregate };
  }
  // Normalize a Worker-supplied add through the same builder the local parser
  // uses, so action/gender are derived here (never trusted from the model) and
  // an unrecognized relation word safely collapses to 'unknown'.
  if (data?.type === 'add-person' && data.name && data.relationWord && data.target) {
    return buildAddIntent(data.name, data.relationWord, data.target) || { type: 'unknown' };
  }
  if (data?.type === 'unknown') return { type: 'unknown' };
  throw new Error('Unrecognized response shape from Worker.');
}

export async function parseQueryAI(raw) {
  const text = (raw || '').trim();
  if (!text) return { type: 'empty' };
  // Add/create commands WRITE data, so they're resolved strictly and locally
  // and never sent to the Worker — an older/mis-guessing model must not be
  // able to turn "add X as son of Y" into some other (read) intent.
  const addCmd = parseAddCommand(text);
  if (addCmd) return addCmd;
  // An incomplete add is resolved locally too — never sent to the Worker, which
  // would just classify it as a generic 'meta' question and lose the intent.
  if (looksLikeAddAttempt(text)) return { type: 'add-incomplete' };
  // Edit/set commands also WRITE, so they stay local and never hit the Worker.
  const editCmd = parseEditCommand(text);
  if (editCmd) return editCmd;
  try {
    const aiResult = await withDeadline(callAskWorker(text), AI_TIMEOUT_MS);
    // If the Worker didn't produce a concrete, actionable intent — it gave up
    // ('unknown') or fell back to a generic 'meta' (which older deployed
    // Workers, predating the attribute-query intent, do for any non-relationship
    // question) — give the local patterns a second chance, and prefer them only
    // when they DO resolve to something concrete.
    if (aiResult?.type === 'unknown' || aiResult?.type === 'meta') {
      const local = parseQuery(raw);
      if (local.type !== 'unknown' && local.type !== 'meta' && local.type !== 'empty') return local;
    }
    return aiResult;
  } catch (err) {
    console.warn('parseQueryAI: falling back to local parser', err);
    return parseQuery(raw);
  }
}

// Ranked substring match against display names — exact match wins outright,
// then a first-name/starts-with match, then a general "contains" fallback.
// Returns every match at the best tier found so the caller can tell a clean
// single hit from a genuine ambiguity (two "Amutha"s in the tree, say).
export function findPersonMatches(persons, nameText) {
  const term = (nameText || '').trim().toLowerCase();
  if (!term) return [];
  const all = Object.values(persons).filter((p) => !p.isPlaceholder);

  const exact = all.filter((p) => getDisplayName(p).toLowerCase() === term);
  if (exact.length) return exact;

  const startsWith = all.filter(
    (p) => p.firstName?.toLowerCase() === term || getDisplayName(p).toLowerCase().startsWith(term)
  );
  if (startsWith.length) return startsWith;

  return all.filter((p) => getDisplayName(p).toLowerCase().includes(term));
}

const HELP_MESSAGE =
  'Try "How is X related to Y?" or "Who are X\'s cousins?" — first/last names both work.';

// Shown for a "meta" question (about the tool itself, not a specific
// relationship) — describes scope and what data actually exists, so someone
// asking "what can you do" gets a real answer instead of a rejection.
const META_MESSAGE =
  "I can answer questions about this family tree: \"How is X related to Y?\" (their relationship, in Tamil and English, plus a button to replay it on the tree), \"Who are X's cousins/children/siblings/etc?\", \"Whose birthday is coming up next?\", and questions about recorded details — jobs (\"who works as a teacher?\"), places (\"who lives in Chennai?\"), counts (\"how many people are in the tree?\"), or by gender, living/deceased, birth year, or name. I can also add someone new — e.g. \"add Ravi as son of Kumar\" or \"add a daughter named Priya to Meena\" — and make simple edits — \"set Ravi's job to teacher\", \"Ravi lives in Chennai\", \"mark Kumar as deceased\", or \"Ravi married Priya\" — always with a confirm button before saving. I only know what's recorded here — names, gender, birth/death dates, parents, children, marriages, jobs, and places.";

// Shown when someone clearly wants to add a person but hasn't said who or how
// they connect — points them at the full phrasing rather than the generic help.
const ADD_HELP_MESSAGE =
  "To add someone, tell me their name and how they connect to a person already in the tree — for example: \"add Ravi as son of Kumar\", \"add a daughter named Priya to Meena\", or \"add Latha as Kumar's wife\". I'll show a confirm button before anything is saved.";

// A name slot pinned to one specific id (see resolveAnswer's `chosen` param)
// skips findPersonMatches entirely — used when the caller already resolved an
// earlier ambiguity ("did you mean Ilan Velmurugan or Ilango Unknown?") and is
// re-answering the SAME question with that pick locked in, rather than a
// fresh name lookup that could turn up ambiguous all over again.
function resolveNameSlot(persons, nameText, chosenId) {
  if (chosenId) return persons[chosenId] ? [persons[chosenId]] : [];
  return findPersonMatches(persons, nameText);
}

// Orchestrates a parsed query + the relationship engine into one of a few
// result kinds the UI can render directly:
//   'relation'   — a single answer, with English/Tamil terms and the path
//   'list'       — every relative of a person matching the asked-for word
//   'ambiguous'  — a name matched more than one person; `slot` says which
//                  name ('nameA'/'nameB'/'name') the caller should re-resolve
//                  by passing it in `chosen` on a follow-up call, so picking
//                  one of `candidates` answers the ORIGINAL question instead
//                  of just navigating away from it
//   'error'      — couldn't find a person, no connection exists, or the
//                  question didn't match any recognized phrasing
// `chosen` is an optional { nameA?, nameB?, name? } map of slot -> personId,
// for resolving one of the ambiguous cases above without re-parsing the text.
export function resolveAnswer(persons, parsed, chosen = {}) {
  if (!parsed || parsed.type === 'empty') return { kind: 'empty' };
  if (parsed.type === 'meta') return { kind: 'meta', message: META_MESSAGE };
  if (parsed.type === 'add-incomplete') return { kind: 'meta', message: ADD_HELP_MESSAGE };
  if (parsed.type === 'unknown') return { kind: 'error', message: `I didn't understand that. ${HELP_MESSAGE}` };

  if (parsed.type === 'birthday-next') {
    // Same isAlive filter and sort BirthdayWidget already uses — deceased
    // family members don't have an "upcoming" birthday to report.
    const today = new Date();
    const upcoming = Object.values(persons)
      .filter((p) => !p.isPlaceholder && p.isAlive)
      .map((p) => ({ person: p, days: getDaysUntilBirthday(p.dob, today) }))
      .filter((e) => e.days != null)
      .sort((a, b) => a.days - b.days)
      .slice(0, 5);
    if (!upcoming.length) return { kind: 'error', message: "No one's birth date is recorded, so I can't tell." };
    return { kind: 'birthdays', upcoming };
  }

  if (parsed.type === 'relation-between') {
    const aMatches = resolveNameSlot(persons, parsed.nameA, chosen.nameA);
    if (!aMatches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.nameA.trim()}".` };
    if (aMatches.length > 1) return { kind: 'ambiguous', slot: 'nameA', term: parsed.nameA, candidates: aMatches };

    const bMatches = resolveNameSlot(persons, parsed.nameB, chosen.nameB);
    if (!bMatches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.nameB.trim()}".` };
    if (bMatches.length > 1) return { kind: 'ambiguous', slot: 'nameB', term: parsed.nameB, candidates: bMatches };

    const fromPerson = aMatches[0];
    const toPerson = bMatches[0];
    if (fromPerson.id === toPerson.id) return { kind: 'error', message: "That's the same person." };

    const path = getRelationshipPath(persons, fromPerson.id, toPerson.id);
    if (!path) {
      return {
        kind: 'error',
        message: `I couldn't find a blood or marriage connection between ${getDisplayName(fromPerson)} and ${getDisplayName(toPerson)}.`,
      };
    }
    const english = getRelationshipLabel(persons, toPerson.id, fromPerson.id);
    const tamil = getRelationshipLabelTamil(persons, toPerson.id, fromPerson.id);
    return { kind: 'relation', fromPerson, toPerson, english, tamil, path };
  }

  if (parsed.type === 'relation-list') {
    const matches = resolveNameSlot(persons, parsed.name, chosen.name);
    if (!matches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.name.trim()}".` };
    if (matches.length > 1) return { kind: 'ambiguous', slot: 'name', term: parsed.name, candidates: matches };

    const person = matches[0];
    // Spouse words map to the direct "Spouse" label (gender-neutral in the
    // engine), not a word-match — otherwise "wife" misses the real spouse and
    // wrongly matches compound labels like "Cousin's Wife".
    const SPOUSE_GENDER = { husband: 'male', wife: 'female', spouse: null };
    const relWord = singularize(parsed.relationWord);
    if (relWord in SPOUSE_GENDER) {
      const wantGender = SPOUSE_GENDER[relWord];
      const spouses = Object.values(persons)
        .filter((p) => !p.isPlaceholder && p.id !== person.id)
        .map((p) => ({ person: p, label: getRelationshipLabel(persons, p.id, person.id) }))
        .filter((r) => r.label === 'Spouse' && (!wantGender || r.person.gender === wantGender));
      return { kind: 'list', person, relationWord: parsed.relationWord, relatives: spouses };
    }
    const relatives = Object.values(persons)
      .filter((p) => !p.isPlaceholder && p.id !== person.id)
      .map((p) => ({ person: p, label: getRelationshipLabel(persons, p.id, person.id) }))
      .filter((r) => r.label && labelMatchesRelation(r.label, parsed.relationWord));
    return { kind: 'list', person, relationWord: parsed.relationWord, relatives };
  }

  if (parsed.type === 'add-person') {
    // Resolve WHO the new person attaches to first — same name-matching and
    // "did you mean…" disambiguation (slot 'target') every other query uses.
    const matches = resolveNameSlot(persons, parsed.target, chosen.target);
    if (!matches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.target.trim()}" to attach the new person to.` };
    if (matches.length > 1) return { kind: 'ambiguous', slot: 'target', term: parsed.target, candidates: matches };
    const target = matches[0];

    // These two are structurally impossible, so they're caught here (with a
    // clear reason) rather than silently no-op'ing in the mutation later.
    if (parsed.action === 'spouse' && target.spouseId) {
      return { kind: 'error', message: `${getDisplayName(target)} already has a spouse recorded — remove the existing one first if this is a correction.` };
    }
    if (parsed.action === 'parent' && (target.parentIds?.length || 0) >= 2) {
      return { kind: 'error', message: `${getDisplayName(target)} already has two parents recorded.` };
    }

    const parts = parsed.name.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' '); // '' lets the mutation apply the surname convention
    return {
      kind: 'add-confirm',
      target,
      action: parsed.action,
      relationWord: parsed.relationWord,
      firstName,
      lastName,
      gender: parsed.gender || 'other',
    };
  }

  if (parsed.type === 'edit-person') {
    const { op } = parsed;

    if (op === 'set-married') {
      const aMatches = resolveNameSlot(persons, parsed.nameA, chosen.nameA);
      if (!aMatches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.nameA.trim()}".` };
      if (aMatches.length > 1) return { kind: 'ambiguous', slot: 'nameA', term: parsed.nameA, candidates: aMatches };
      const bMatches = resolveNameSlot(persons, parsed.nameB, chosen.nameB);
      if (!bMatches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.nameB.trim()}".` };
      if (bMatches.length > 1) return { kind: 'ambiguous', slot: 'nameB', term: parsed.nameB, candidates: bMatches };
      const a = aMatches[0];
      const b = bMatches[0];
      if (a.id === b.id) return { kind: 'error', message: "That's the same person." };
      if (a.spouseId && a.spouseId !== b.id) return { kind: 'error', message: `${getDisplayName(a)} already has a spouse recorded.` };
      if (b.spouseId && b.spouseId !== a.id) return { kind: 'error', message: `${getDisplayName(b)} already has a spouse recorded.` };
      const when = parsed.date ? ` (married ${parsed.date})` : '';
      return {
        kind: 'edit-confirm',
        op,
        personA: a,
        personB: b,
        date: parsed.date,
        summary: `Record that ${getDisplayName(a)} and ${getDisplayName(b)} are married${when}?`,
        doneMessage: `Recorded ${getDisplayName(a)} and ${getDisplayName(b)} as married.`,
      };
    }

    const matches = resolveNameSlot(persons, parsed.name, chosen.name);
    if (!matches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.name.trim()}".` };
    if (matches.length > 1) return { kind: 'ambiguous', slot: 'name', term: parsed.name, candidates: matches };
    const person = matches[0];

    if (op === 'mark-deceased') {
      const when = parsed.date ? ` (died ${parsed.date})` : '';
      return { kind: 'edit-confirm', op, person, date: parsed.date, summary: `Mark ${getDisplayName(person)} as deceased${when}?`, doneMessage: `Marked ${getDisplayName(person)} as deceased.` };
    }
    if (op === 'mark-alive') {
      return { kind: 'edit-confirm', op, person, summary: `Mark ${getDisplayName(person)} as living?`, doneMessage: `Marked ${getDisplayName(person)} as living.` };
    }
    if (op === 'set-field') {
      if (parsed.field === 'dob' && (parsed.badDate || !parsed.value)) {
        return { kind: 'error', message: "I couldn't read that date — try something like \"14 June 1990\" or \"1990\"." };
      }
      const label = EDIT_FIELD_LABEL[parsed.field] || parsed.field;
      return {
        kind: 'edit-confirm',
        op,
        person,
        field: parsed.field,
        value: parsed.value,
        summary: `Set ${getDisplayName(person)}'s ${label} to "${parsed.value}"?`,
        doneMessage: `Updated ${getDisplayName(person)}'s ${label}.`,
      };
    }
    return { kind: 'error', message: `I didn't understand that. ${HELP_MESSAGE}` };
  }

  if (parsed.type === 'attribute-query') {
    const { field } = parsed;
    if (!ATTRIBUTE_FIELDS.has(field)) return { kind: 'error', message: `I didn't understand that. ${HELP_MESSAGE}` };
    const value = parsed.value || '';
    let people = Object.values(persons).filter((p) => !p.isPlaceholder);
    if (field !== 'all') people = people.filter((p) => personMatchesAttribute(p, field, value));
    people.sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
    return { kind: 'people', field, value, aggregate: !!parsed.aggregate, people, summary: describeAttribute(field, value, people.length) };
  }

  return { kind: 'error', message: `I didn't understand that. ${HELP_MESSAGE}` };
}

export function answerQuery(persons, rawText) {
  return resolveAnswer(persons, parseQuery(rawText), {});
}

export { HELP_MESSAGE };
