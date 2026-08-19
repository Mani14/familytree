import { useMemo, useState } from 'react';
import Modal from './Modal';
import { getDisplayName, getFullName, getInitials } from '../utils/familyUtils';
import '../styles/AttachYourself.css';

const MAX_RESULTS = 8;

// Relation options offered for the chosen anchor person, mirroring TreeNode's
// QUICK_ADD_OPTIONS eligibility rules (can't add a 2nd parent or a 2nd spouse).
const RELATION_OPTIONS = [
  { mode: 'addChild', label: 'Child', show: () => true },
  { mode: 'addParent', label: 'Parent', show: (p) => p.parentIds.length < 2 },
  { mode: 'addSpouse', label: 'Spouse', show: (p) => !p.spouseId },
  { mode: 'addSibling', label: 'Sibling', show: () => true },
];

// Guided wizard for a signed-in user who isn't linked to a person yet.
// 'search' (default): search for your OWN name first — if it's already there,
// tap it and you're done, no separate yes/no question needed up front.
// 'searchRelative' (+ anchor once picked): the "my name isn't listed" path —
// search for a parent/sibling already in the tree to attach near, then pick
// how you're related to them.
export default function AttachYourself({ persons, onAttach, onMarkAsMe, onCancel }) {
  const [stage, setStage] = useState('search');
  const [query, setQuery] = useState('');
  const [anchorId, setAnchorId] = useState(null);
  const [pendingMeId, setPendingMeId] = useState(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return Object.values(persons)
      .filter((person) => !person.isPlaceholder && getDisplayName(person).toLowerCase().includes(term))
      .slice(0, MAX_RESULTS);
  }, [persons, query]);

  const anchor = anchorId ? persons[anchorId] : null;
  const pendingMe = pendingMeId ? persons[pendingMeId] : null;
  const options = anchor ? RELATION_OPTIONS.filter((opt) => opt.show(anchor)) : [];

  const goToStage = (next) => {
    setStage(next);
    setQuery('');
    setAnchorId(null);
  };

  let step;
  if (stage === 'search') {
    step = (
      <div className="attach-step">
        <p className="attach-step-hint">Search for your own name — if you're already listed, tap it below.</p>
        <input
          type="text"
          autoFocus
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="attach-search-input"
        />
        {matches.length > 0 && (
          <ul className="attach-search-results">
            {matches.map((person) => (
              <li key={person.id}>
                <button type="button" onClick={() => { setPendingMeId(person.id); setStage('confirmMe'); }}>
                  {getDisplayName(person)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && matches.length === 0 && (
          <p className="attach-step-empty">
            No one matching "{query.trim()}" found — try just your first name, or tap below if you're not in the tree yet.
          </p>
        )}
        <button type="button" className="attach-forward-btn" onClick={() => goToStage('searchRelative')}>
          My name isn't listed →
        </button>
      </div>
    );
  } else if (stage === 'confirmMe' && pendingMe) {
    step = (
      <div className="attach-step">
        <div className="attach-anchor-preview">
          <span className={`avatar avatar-${pendingMe.gender}`}>
            {pendingMe.photo ? <img src={pendingMe.photo} alt="" /> : getInitials(pendingMe)}
          </span>
          <span className="attach-anchor-name">{getFullName(pendingMe)}</span>
        </div>
        <p className="attach-step-hint">Is this you?</p>
        <button type="button" className="attach-forward-btn attach-confirm-btn" onClick={() => onMarkAsMe(pendingMeId)}>
          ✓ Yes, that's me
        </button>
        <button type="button" className="attach-back-btn attach-back-btn-strong" onClick={() => { setPendingMeId(null); setStage('search'); }}>
          ← No, search again
        </button>
      </div>
    );
  } else if (stage === 'searchRelative' && !anchor) {
    step = (
      <div className="attach-step">
        <p className="attach-step-hint">Search for your parent's or sibling's name.</p>
        <input
          type="text"
          autoFocus
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="attach-search-input"
        />
        {matches.length > 0 && (
          <ul className="attach-search-results">
            {matches.map((person) => (
              <li key={person.id}>
                <button type="button" onClick={() => setAnchorId(person.id)}>
                  {getDisplayName(person)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && matches.length === 0 && (
          <p className="attach-step-empty">
            No one matching "{query.trim()}" found — try just their first name.
          </p>
        )}
        <button type="button" className="attach-back-btn attach-back-btn-strong" onClick={() => goToStage('search')}>
          ← Back
        </button>
      </div>
    );
  } else {
    // The actual person's avatar + name, with the SAME "+" badge and dropdown
    // look TreeNode's own quick-add popover uses on the canvas — pre-expanded
    // here rather than requiring a tap, since that popover only hides its
    // options to cut clutter on a crowded canvas, which doesn't apply in a
    // spacious modal with just one card in it. The point is familiarity: this
    // should look like the exact action they'll use again later in the tree
    // itself, not a one-off wizard-only control.
    step = (
      <div className="attach-step">
        <div className="attach-anchor-preview">
          <span className="attach-anchor-avatar-wrap">
            <span className={`avatar avatar-${anchor.gender}`}>
              {anchor.photo ? <img src={anchor.photo} alt="" /> : getInitials(anchor)}
            </span>
            <span className="attach-anchor-add-badge" aria-hidden="true">+</span>
          </span>
          <span className="attach-anchor-name">{getFullName(anchor)}</span>
          <div className="attach-relation-menu">
            {options.map((opt) => (
              <button key={opt.mode} type="button" onClick={() => onAttach(anchor.id, opt.mode)}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="attach-back-btn attach-back-btn-strong" onClick={() => setAnchorId(null)}>
          ← Choose a different relative
        </button>
      </div>
    );
  }

  // Reinforces what each screen is for without a separate step-counter UI —
  // the modal's own title changes as you move through the wizard.
  let title = 'Find Yourself';
  if (stage === 'confirmMe') title = 'Is This You?';
  else if (stage === 'searchRelative' && !anchor) title = 'Find a Relative';
  else if (anchor) title = 'How Are You Related?';

  return (
    <Modal isOpen onClose={onCancel} title={title} width={420} className="attach-yourself-modal">
      {/* Modal's own `title` prop only ever becomes an invisible aria-label
          (see Modal.jsx) — every other modal in this app renders its own
          visible heading in its content for a sighted reason to actually see
          which step they're on, and this one needs that more than most. */}
      <h2 className="attach-yourself-title">{title}</h2>
      {step}
    </Modal>
  );
}
