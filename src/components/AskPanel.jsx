import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Route, Send } from 'lucide-react';
import { formatBirthdayNoYear, getDisplayName } from '../utils/familyUtils';
import { parseQueryAI, resolveAnswer, substituteSelfReferences } from '../utils/naturalQuery';
import Modal from './Modal';
import '../styles/AskPanel.css';

// `prefill` examples (the add-a-person ones) only drop their text into the box
// on click instead of running — running them would show a confirm every time,
// and a careless repeated confirm could add duplicates.
const EXAMPLES = [
  { text: 'How is Iniya related to Manikandan?' },
  { text: "Who are Manikandan's cousins?" },
  { text: 'Who works as a software engineer?' },
  { text: 'Whose birthday is coming up next?' },
  { text: 'Add <name> as daughter of <person>', prefill: true },
  { text: "Add <name> as <person>'s brother", prefill: true },
];

function formatDaysUntil(days) {
  if (days === 0) return 'Today!';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

function withArticle(word) {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function AnswerBody({ result, onGo, onShowTree, onResolveAmbiguous, onConfirmAdd, onConfirmEdit }) {
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

  if (result.kind === 'meta') {
    return <p className="ask-panel-meta">{result.message}</p>;
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
    // Tamil-only is a normal, complete answer (see PersonDetail's own badge —
    // not every relationship reduces to a clean English word), so it's shown
    // alone rather than paired with a vague placeholder. The generic fallback
    // is reserved for the genuinely rare case where NEITHER language could
    // name it — a connection that exists (there IS a path — see "Show on
    // tree") but runs through enough marriages that it's too distant/
    // roundabout for the app's relationship rules to name specifically.
    const term = tamil && english
      ? `${tamil} · ${english}`
      : tamil || english || "connected through marriage, but too distant for a specific term — tap “Show on tree” to see how";
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
          {term}
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

  if (result.kind === 'birthdays') {
    return (
      <div className="ask-panel-answer">
        <ul className="ask-panel-people">
          {result.upcoming.map(({ person, days }) => (
            <li key={person.id}>
              <button type="button" onClick={() => onGo(person.id)}>{getDisplayName(person)}</button>
              <span className="ask-panel-people-label">
                {formatDaysUntil(days)} · {formatBirthdayNoYear(person.dob)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.kind === 'add-confirm') {
    const { target, relationWord, firstName, lastName, gender } = result;
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    return (
      <div className="ask-panel-answer ask-panel-confirm">
        <p>
          Add <strong>{fullName}</strong>
          {gender === 'other' ? ' (gender not set — you can fill it in after)' : ` (${gender})`} as{' '}
          {withArticle(relationWord)} of{' '}
          <button type="button" className="ask-panel-name" onClick={() => onGo(target.id)}>
            {getDisplayName(target)}
          </button>
          ?
        </p>
        <button type="button" className="ask-panel-confirm-yes" onClick={onConfirmAdd}>
          Add {firstName}
        </button>
      </div>
    );
  }

  if (result.kind === 'add-done') {
    return (
      <p className="ask-panel-meta">
        Added <strong>{result.name}</strong> as {withArticle(result.relationWord)} of{' '}
        {getDisplayName(result.target)}.{' '}
        <button type="button" className="ask-panel-name" onClick={() => onGo(result.newId)}>
          View their card
        </button>
      </p>
    );
  }

  if (result.kind === 'edit-confirm') {
    return (
      <div className="ask-panel-answer ask-panel-confirm">
        <p>{result.summary}</p>
        <button type="button" className="ask-panel-confirm-yes" onClick={onConfirmEdit}>
          Confirm
        </button>
      </div>
    );
  }

  if (result.kind === 'edit-done') {
    return (
      <p className="ask-panel-meta">
        {result.message}{' '}
        {result.personId && (
          <button type="button" className="ask-panel-name" onClick={() => onGo(result.personId)}>
            View their card
          </button>
        )}
      </p>
    );
  }

  if (result.kind === 'people') {
    const { people, summary, field } = result;
    // 'all' is a plain head-count — the summary line already says the number,
    // so skip dumping the entire tree as a list. Every other field shows the
    // matched people (count questions included — count + names is useful).
    const showList = field !== 'all' && people.length > 0;
    return (
      <div className="ask-panel-answer">
        <p>{summary}</p>
        {showList && (
          <ul className="ask-panel-people">
            {people.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onGo(p.id)}>{getDisplayName(p)}</button>
                {p.work ? <span className="ask-panel-people-label">{p.work}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return null;
}

// A plain-English question box over the family tree. Answering (relationship
// terms, Tamil translations, tree paths) always stays entirely local, in the
// app's own already-tuned relationship engine (naturalQuery.js) — no family
// data is ever sent anywhere for that part. Understanding the QUESTION itself
// is AI-assisted (parseQueryAI, via a Cloudflare Worker + a free-tier LLM) so
// far more phrasings work than a fixed set of regex patterns ever could; only
// the question text itself is sent for that, never any person's data, and it
// falls back to the local parser automatically if the AI call fails.
// `selfName` (the signed-in user's own first name, if linked) lets "my
// cousins"/"related to me" resolve to an actual person — see
// substituteSelfReferences.
export default function AskPanel({ persons, isOpen, onClose, onSelectPerson, onShowConnection, selfName, onAddPerson, onEditPerson }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  // Most-recent-first session log — not persisted, just lets someone ask a
  // follow-up without losing the previous answer off-screen. Each entry gets
  // a stable id (not just its array position) since prepending shifts every
  // existing entry's index on every new question.
  const [history, setHistory] = useState([]);
  const nextEntryId = useRef(0);
  const [pending, setPending] = useState(false);
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const voiceSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Stop any in-flight speech recognition if the panel unmounts.
  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* already stopped */ } }, []);

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

    // "my"/"me" resolved to the signed-in user's own name before parsing —
    // the history still shows what was actually typed, only the text fed
    // into the parser is substituted.
    const forParsing = substituteSelfReferences(trimmed, selfName);
    let parsed;
    try {
      parsed = await parseQueryAI(forParsing);
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

  // Commits an 'add-confirm' preview to the actual tree via the mutation the
  // parent passed down (addChild/addSpouse/addParent/addSibling). The write
  // only ever happens HERE, on the explicit button press — never straight out
  // of parsing — and the entry flips to an 'add-done' result on success.
  const confirmAdd = (entryId) => {
    const entry = history.find((e) => e.id === entryId);
    if (!entry || entry.result.kind !== 'add-confirm') return;
    const r = entry.result;
    let result;
    if (!onAddPerson) {
      result = { kind: 'error', message: 'Adding people isn’t available right now.' };
    } else {
      const partial = { firstName: r.firstName, gender: r.gender };
      if (r.lastName) partial.lastName = r.lastName;
      let newId;
      try {
        newId = onAddPerson(r.action, r.target.id, partial);
      } catch (err) {
        console.error('AskPanel: add failed', err);
        result = { kind: 'error', message: 'Something went wrong adding that person.' };
      }
      if (!result) {
        if (!newId) {
          result = { kind: 'error', message: 'Couldn’t add that person — that relationship may already be filled.' };
        } else {
          const fullName = [r.firstName, r.lastName].filter(Boolean).join(' ');
          result = { kind: 'add-done', name: fullName, relationWord: r.relationWord, target: r.target, newId };
        }
      }
    }
    setHistory((prev) => prev.map((e) => (e.id === entryId ? { ...e, result } : e)));
  };

  // Commits an 'edit-confirm' preview via the parent's onEditPerson mutation —
  // the mutation runs OUTSIDE the setHistory updater (calling a parent setState
  // inside a state updater triggers a "setState during render" warning).
  const confirmEdit = (entryId) => {
    const entry = history.find((e) => e.id === entryId);
    if (!entry || entry.result.kind !== 'edit-confirm') return;
    const r = entry.result;
    let result;
    if (!onEditPerson) {
      result = { kind: 'error', message: 'Editing isn’t available right now.' };
    } else {
      let payload;
      if (r.op === 'set-field') payload = { personId: r.person.id, field: r.field, value: r.value };
      else if (r.op === 'mark-deceased') payload = { personId: r.person.id, date: r.date };
      else if (r.op === 'mark-alive') payload = { personId: r.person.id };
      else if (r.op === 'set-married') payload = { personAId: r.personA.id, personBId: r.personB.id, date: r.date };
      let ok;
      try {
        ok = onEditPerson(r.op, payload);
      } catch (err) {
        console.error('AskPanel: edit failed', err);
        result = { kind: 'error', message: 'Something went wrong making that change.' };
      }
      if (!result) {
        const personId = r.person?.id || r.personA?.id;
        result = ok
          ? { kind: 'edit-done', message: r.doneMessage || 'Done.', personId }
          : { kind: 'error', message: 'Couldn’t make that change.' };
      }
    }
    setHistory((prev) => prev.map((e) => (e.id === entryId ? { ...e, result } : e)));
  };

  const go = (id) => {
    onSelectPerson?.(id);
    onClose?.();
  };

  const showTree = (fromId, toId) => {
    onShowConnection?.(fromId, toId);
    onClose?.();
  };

  // Drops an example into the box (without running it) so the user edits the
  // placeholders and submits it themselves — used for the add-a-person examples.
  const fillQuery = (text) => {
    setQuery(text);
    inputRef.current?.focus();
  };

  // Browser on-device speech-to-text (Web Speech API) — free, no server, works
  // offline on most mobiles. The live transcript fills the box; on a final
  // result the question is asked automatically.
  const toggleVoice = () => {
    if (!voiceSupported || pending) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk; else interim += chunk;
      }
      setQuery(`${finalText}${interim}`.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      const spoken = finalText.trim();
      if (spoken) ask(spoken);
    };
    recognitionRef.current = rec;
    setQuery('');
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ask About the Family" width="520px" className="ask-panel">
      <h2>Ask About the Family</h2>
      <p className="ask-panel-hint">
        Ask in plain English — the answer itself always stays local to this tree; only the question text is sent
        along to understand freer phrasing.
      </p>

      <form className="ask-panel-form" onSubmit={(e) => { e.preventDefault(); ask(query); }}>
        <div className="ask-panel-input-wrap">
          <input
            type="text"
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="How is Iniya related to Manikandan?"
            disabled={pending}
            autoFocus
          />
          {voiceSupported && (
            <button
              type="button"
              className={`ask-panel-mic${listening ? ' is-listening' : ''}`}
              onClick={toggleVoice}
              disabled={pending}
              aria-label={listening ? 'Stop listening' : 'Ask by voice'}
              title={listening ? 'Listening… tap to stop' : 'Ask by voice'}
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
          )}
        </div>
        <button type="submit" aria-label="Ask" title="Ask" disabled={pending}>
          {pending ? <Loader2 size={15} className="ask-panel-spinner" /> : <Send size={15} />}
        </button>
      </form>

      {history.length === 0 ? (
        <div className="ask-panel-examples">
          <span>Try asking:</span>
          <ul>
            {EXAMPLES.map((ex) => (
              <li key={ex.text}>
                <button type="button" onClick={() => (ex.prefill ? fillQuery(ex.text) : ask(ex.text))} disabled={pending}>{ex.text}</button>
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
                onConfirmAdd={() => confirmAdd(entry.id)}
                onConfirmEdit={() => confirmEdit(entry.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
