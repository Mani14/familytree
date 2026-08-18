import { useState } from 'react';
import { Route, Send } from 'lucide-react';
import { getDisplayName } from '../utils/familyUtils';
import { answerQuery } from '../utils/naturalQuery';
import Modal from './Modal';
import '../styles/AskPanel.css';

const EXAMPLES = [
  'How is Sundari related to Kesavamoorthy?',
  "Who are Manikandan's cousins?",
  "Who are Kesavamoorthy's children?",
];

function AnswerBody({ result, onGo, onShowTree }) {
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
              <button type="button" onClick={() => onGo(p.id)}>{getDisplayName(p)}</button>
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

// A plain-English question box over the family tree — answered entirely from
// the tree's own already-tuned relationship engine (naturalQuery.js), not a
// third-party AI chatbot: nothing about anyone's family ever leaves the
// browser, there's no API key or rate limit, and the answers are exactly as
// accurate as the app's own carefully-tuned Tamil kinship logic already is.
export default function AskPanel({ persons, isOpen, onClose, onSelectPerson, onShowConnection }) {
  const [query, setQuery] = useState('');
  // Most-recent-first session log — not persisted, just lets someone ask a
  // follow-up without losing the previous answer off-screen.
  const [history, setHistory] = useState([]);

  const ask = (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // No error boundary sits above this panel — an uncaught exception here
    // would otherwise take the whole app down with it, not just this modal.
    let result;
    try {
      result = answerQuery(persons, trimmed);
    } catch (err) {
      console.error('AskPanel: answerQuery threw', err);
      result = { kind: 'error', message: "Something went wrong answering that — try rephrasing it." };
    }
    setHistory((prev) => [{ question: trimmed, result }, ...prev]);
    setQuery('');
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
        Ask in plain English — answered instantly from the tree itself, nothing leaves your browser.
      </p>

      <form className="ask-panel-form" onSubmit={(e) => { e.preventDefault(); ask(query); }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="How is Sundari related to Kesavamoorthy?"
          autoFocus
        />
        <button type="submit" aria-label="Ask" title="Ask">
          <Send size={15} />
        </button>
      </form>

      {history.length === 0 ? (
        <div className="ask-panel-examples">
          <span>Try asking:</span>
          <ul>
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button type="button" onClick={() => ask(ex)}>{ex}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="ask-panel-history">
          {history.map((entry, index) => (
            <li key={index} className="ask-panel-entry">
              <p className="ask-panel-question">{entry.question}</p>
              <AnswerBody result={entry.result} onGo={go} onShowTree={showTree} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
