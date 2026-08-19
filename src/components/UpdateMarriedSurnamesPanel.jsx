import { useEffect, useMemo, useState } from 'react';
import { Check, UserCheck } from 'lucide-react';
import { getFullName, getPerson, suggestMarriedSurname } from '../utils/familyUtils';
import Modal from './Modal';
import '../styles/UpdateMarriedSurnamesPanel.css';

// Finds every married woman whose CURRENT last name isn't her husband's first
// name — e.g. someone who still has her father's/maiden name recorded because
// she married after her record was created and lastName is never recomputed
// on its own (see suggestLastName's comment in familyUtils.js). Unlike "Fill
// Missing Surnames", this OVERWRITES an existing value, so it's shown as a
// reviewable, opt-in-per-row list rather than a single silent bulk action.
function findCandidates(persons) {
  const rows = [];
  for (const id of Object.keys(persons)) {
    const person = persons[id];
    const suggestion = suggestMarriedSurname(persons, id);
    if (!suggestion || suggestion === person.lastName) continue;
    rows.push({
      id,
      name: getFullName(person),
      currentLastName: person.lastName || '(blank)',
      suggestedLastName: suggestion,
      spouseName: getFullName(getPerson(persons, person.spouseId)),
    });
  }
  return rows;
}

export default function UpdateMarriedSurnamesPanel({ isOpen, onClose, persons, onApply }) {
  const candidates = useMemo(() => (isOpen ? findCandidates(persons) : []), [isOpen, persons]);
  const [checked, setChecked] = useState(() => new Set());
  const [applied, setApplied] = useState(null);

  // Every candidate starts pre-selected whenever the list is (re)computed — most
  // admins reviewing this want to accept everything and only uncheck exceptions.
  useEffect(() => {
    setChecked(new Set(candidates.map((c) => c.id)));
    setApplied(null);
  }, [candidates]);

  const toggle = (id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    const updatesById = {};
    for (const c of candidates) {
      if (checked.has(c.id)) updatesById[c.id] = { lastName: c.suggestedLastName };
    }
    const count = Object.keys(updatesById).length;
    if (count > 0) onApply(updatesById);
    setApplied(count);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Update Married Surnames" width="540px" className="married-surnames-panel">
      <h2><UserCheck size={18} /> Update Married Surnames</h2>
      <p className="married-surnames-summary">
        People below are married with a last name that doesn't match their spouse's
        first name — likely recorded before the marriage. Review and uncheck any that
        should stay as-is (e.g. someone who kept her own name on purpose), then apply.
      </p>

      {candidates.length === 0 ? (
        <div className="married-surnames-empty">
          <Check size={28} />
          <p>No married surnames need updating.</p>
        </div>
      ) : (
        <>
          <ul className="married-surnames-list">
            {candidates.map((c) => (
              <li key={c.id} className="married-surnames-item">
                <label>
                  <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
                  <div className="married-surnames-body">
                    <span className="married-surnames-name">{c.name} <span className="married-surnames-muted">(married to {c.spouseName})</span></span>
                    <span className="married-surnames-change">
                      {c.currentLastName} <span className="married-surnames-arrow">&rarr;</span> {c.suggestedLastName}
                    </span>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className="admin-secondary-btn" onClick={handleApply} disabled={checked.size === 0}>
            Apply to {checked.size} selected
          </button>
        </>
      )}

      {applied !== null && (
        <p className="married-surnames-summary">
          {applied > 0 ? `Updated ${applied} surname${applied === 1 ? '' : 's'}.` : 'Nothing selected to update.'}
        </p>
      )}
    </Modal>
  );
}
