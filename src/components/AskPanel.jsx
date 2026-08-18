import { useRef, useState } from 'react';
import { Loader2, Route, Send } from 'lucide-react';
import { getDisplayName } from '../utils/familyUtils';
import { parseQueryAI, resolveAnswer } from '../utils/naturalQuery';
import Modal from './Modal';
import '../styles/AskPanel.css';

const EXAMPLES = [
  'How is Sundari related to Kesavamoorthy?',
  "Who are Manikandan's cousins?",
  "Who are Kesavamoorthy's children?",
];

function AnswerBody({ result, onGo, onShowTree, onResolveAmbiguous }) {
  if (result.kind === 'pending') {
    return (
      <p className="ask-panel-pending">
        <Loader2 size={13} className="ask-panel-spinner" /> Thinking…
      </p>
    );
  }

  if (result.kind === 'error') {
    return <p className="ask-panel-error">{result.message}</p>;
  }

  if (result.kind === 'ambiguous') {
    return (
      <div className="ask-panel-answer">
        <p>More than one person matches &ldquo;{result.term.trim()}&rdquo; — did you mean:</p>
        <ul className="ask-panel-people">
          {result.candidates.map((p) => (
            <li key={p.id}>
              {/* Answers the ORIGINAL question with this person picked for the
                  ambiguous slot — not a plain "go to their card" link, or
                  disambiguating would just abandon the question you asked. */}
              <button type="button" onClick={() => onResolveAmbiguous(result.slot, p.id)}>
                {getDisplayName(p)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.kind === 'relation') {
    const { fromPerson, toPerson, english, tamil } = result;
    return (
      <div className="ask-panel-answer">
        <p>
          <button type="button" className="ask-panel-name" onClick={() => onGo(toPerson.id)}>
            {getDisplayName(toPerson)}
          </button>
          {' is '}
          <button type="button" className="ask-panel-name" onClick={() => onGo(fromPerson.id)}>
            {getDisplayName(fromPerson)}
          </button>
          {'’s '}
          {tamil ? `${tamil} · ` : ''}
          {english || 'relative (by marriage further removed)'}
        </p>
        <button type="button" className="ask-panel-show-tree" onClick={() => onShowTree(fromPerson.id, toPerson.id)}>
          <Route size={13} /> Show on tree
        </button>
      </div>
    );
  }

  if (result.kind === 'list') {
    const { person, relationWord, relatives } = result;
    if (!relatives.length) {
      return (
        <p className="ask-panel-error">
          I couldn&rsquo;t find any {relationWord} for {getDisplayName(person)}.
        </p>
      );
    }
    return (
      <div className="ask-panel-answer">
        <p>
          {getDisplayName(person)}&rsquo;s {relationWord}:
        </p>
        <ul className="ask-panel-people">
          {relatives.map(({ person: p, label }) => (
            <li key={p.id}>
              <button type="button" onClick={() => onGo(p.id)}>{getDisplayName(p)}</button>
              <span className="ask-panel-people-label">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}

// A plain-English question box over the family tree. Answering (relationship
// terms, Tamil translations, tree paths) always stays entirely local, in the
// app's own already-tuned relationship engine (naturalQuery.js) — no family
// data is ever sent anywhere for that part. Understanding the QUESTION itself
// is AI-assisted (parseQueryAI, via a Cloud Function + a free-tier LLM) so far
// more phrasings work than a fixed set of regex patterns ever could; only the
// question text itself is sent for that, never any person's data, and it
// falls back to the local parser automatically if the AI call fails.
export default function AskPanel({ persons, isOpen, onClose, onSelectPerson, onShowConnection }) {
  const [query, setQuery] = useState('');
  // Most-recent-first session log — not persisted, just lets someone ask a
  // follow-up without losing the previous answer off-screen. Each entry gets
  // a stable id (not just its array position) since prepending shifts every
  // existing entry's index on every new question.
  const [history, setHistory] = useState([]);
  const nextEntryId = useRef(0);
  const [pending, setPending] = useState(false);

  // Runs resolveAnswer defensively — no error boundary sits above this panel,
  // so an uncaught exception here would otherwise take the whole app down
  // with it, not just this modal.
  const safeResolve = (parsed, chosen) => {
    try {
      return resolveAnswer(persons, parsed, chosen);
    } catch (err) {
      console.error('AskPanel: resolveAnswer threw', err);
      return { kind: 'error', message: 'Something went wrong answering that — try rephrasing it.' };
    }
  };

  const ask = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setQuery('');
    setPending(true);
    const id = nextEntryId.current++;
    // A placeholder shown immediately — the AI call is a real network
    // round-trip, unlike the old purely-local parser, so without this the
    // wait would look exactly like the earlier "nothing happens" bug.
    setHistory((prev) => [{ id, question: trimmed, parsed: null, chosen: {}, result: { kind: 'pending' } }, ...prev]);

    let parsed;
    try {
      parsed = await parseQueryAI(trimmed);
    } catch (err) {
      console.error('AskPanel: parseQueryAI threw', err);
      parsed = { type: 'unknown' };
    }
    const chosen = {};
    const result = safeResolve(parsed, chosen);
    setHistory((prev) => prev.map((entry) => (entry.id === id ? { ...entry, parsed, chosen, result } : entry)));
    setPending(false);
  };

  // Picking a disambiguation candidate re-answers the SAME question with that
  // person pinned to the ambiguous slot, rather than just navigating to their
  // card — a "how is Ilan related to X" question that turned out ambiguous
  // should still end up answered once you say which Ilan you meant, not
  // abandoned in favour of a detail panel.
  const resolveAmbiguous = (entryId, slot, personId) => {
    setHistory((prev) => prev.map((entry) => {
      if (entry.id !== entryId) return entry;
      const chosen = { ...entry.chosen, [slot]: personId };
      return { ...entry, chosen, result: safeResolve(entry.parsed, chosen) };
    }));
  };

  const go = (id) => {
    onSelectPerson?.(id);
    onClose?.();
  };

  const showTree = (fromId, toId) => {
    onShowConnection?.(fromId, toId);
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ask About the Family" width="520px" className="ask-panel">
      <h2>Ask About the Family</h2>
      <p className="ask-panel-hint">
        Ask in plain English — the answer itself always stays local to this tree; only the question text is sent
        along to understand freer phrasing.
      </p>

      <form className="ask-panel-form" onSubmit={(e) => { e.preventDefault(); ask(query); }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="How is Sundari related to Kesavamoorthy?"
          disabled={pending}
          autoFocus
        />
        <button type="submit" aria-label="Ask" title="Ask" disabled={pending}>
          {pending ? <Loader2 size={15} className="ask-panel-spinner" /> : <Send size={15} />}
        </button>
      </form>

      {history.length === 0 ? (
        <div className="ask-panel-examples">
          <span>Try asking:</span>
          <ul>
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button type="button" onClick={() => ask(ex)} disabled={pending}>{ex}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="ask-panel-history">
          {history.map((entry) => (
            <li key={entry.id} className="ask-panel-entry">
              <p className="ask-panel-question">{entry.question}</p>
              <AnswerBody
                result={entry.result}
                onGo={go}
                onShowTree={showTree}
                onResolveAmbiguous={(slot, personId) => resolveAmbiguous(entry.id, slot, personId)}
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
