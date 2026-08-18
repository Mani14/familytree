// Plain-English question answering over the family tree — reuses the existing
// relationship engine (getRelationshipLabel/getRelationshipLabelTamil/
// getRelationshipPath) rather than calling out to any external chatbot API, so
// this stays free, private (no family data ever leaves the browser), and as
// accurate as the app's own already-tuned Tamil kinship logic. Two question
// shapes are supported:
//   "How is X related to Y?"      -> a single relationship, plus the path
//   "Who are X's cousins?"        -> every person whose computed relationship
//                                     to X contains that word
// Anything else returns a helpful "I didn't understand that" error rather than
// guessing — this is pattern-matching, not a real language model.
import { getDisplayName, getRelationshipLabel, getRelationshipLabelTamil, getRelationshipPath } from './familyUtils.js';

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
  const singular = singularize(relationWord);
  if (!singular) return false;
  const words = RELATION_GROUPS[singular] || [singular];
  return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(label));
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

  let m = /^how\s+(?:is|are)\s+(.+?)\s+related\s+to\s+(.+)$/i.exec(text);
  if (m) return { type: 'relation-between', nameA: m[1], nameB: m[2] };

  m = /^how\s+(?:is|are)\s+(.+?)\s+and\s+(.+?)\s+related$/i.exec(text);
  if (m) return { type: 'relation-between', nameA: m[1], nameB: m[2] };

  m = /(?:relationship|connection)\s+(?:between|of)\s+(.+?)\s+and\s+(.+)$/i.exec(text);
  if (m) return { type: 'relation-between', nameA: m[1], nameB: m[2] };

  m = /^what\s+(?:is|are|was)\s+(.+?)\s+to\s+(.+)$/i.exec(text);
  if (m) return { type: 'relation-between', nameA: m[1], nameB: m[2] };

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

  return { type: 'unknown' };
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

// Orchestrates parseQuery + findPersonMatches + the relationship engine into
// one of a few result kinds the UI can render directly:
//   'relation'   — a single answer, with English/Tamil terms and the path
//   'list'       — every relative of a person matching the asked-for word
//   'ambiguous'  — a name matched more than one person; caller should ask
//                  which one, showing `candidates`
//   'error'      — couldn't find a person, no connection exists, or the
//                  question didn't match any recognized phrasing
export function answerQuery(persons, rawText) {
  const parsed = parseQuery(rawText);
  if (parsed.type === 'empty') return { kind: 'empty' };
  if (parsed.type === 'unknown') return { kind: 'error', message: `I didn't understand that. ${HELP_MESSAGE}` };

  if (parsed.type === 'relation-between') {
    const aMatches = findPersonMatches(persons, parsed.nameA);
    if (!aMatches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.nameA.trim()}".` };
    if (aMatches.length > 1) return { kind: 'ambiguous', term: parsed.nameA, candidates: aMatches };

    const bMatches = findPersonMatches(persons, parsed.nameB);
    if (!bMatches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.nameB.trim()}".` };
    if (bMatches.length > 1) return { kind: 'ambiguous', term: parsed.nameB, candidates: bMatches };

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
    const matches = findPersonMatches(persons, parsed.name);
    if (!matches.length) return { kind: 'error', message: `I couldn't find anyone named "${parsed.name.trim()}".` };
    if (matches.length > 1) return { kind: 'ambiguous', term: parsed.name, candidates: matches };

    const person = matches[0];
    const relatives = Object.values(persons)
      .filter((p) => !p.isPlaceholder && p.id !== person.id)
      .map((p) => ({ person: p, label: getRelationshipLabel(persons, p.id, person.id) }))
      .filter((r) => r.label && labelMatchesRelation(r.label, parsed.relationWord));
    return { kind: 'list', person, relationWord: parsed.relationWord, relatives };
  }

  return { kind: 'error', message: `I didn't understand that. ${HELP_MESSAGE}` };
}

export { HELP_MESSAGE };
