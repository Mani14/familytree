import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from './Modal';
import { TAMIL_RELATIONSHIP_TERMS } from '../utils/tamilRelationshipTerms';
import '../styles/EditRelationshipDialog.css';

const MAX_SUGGESTIONS = 6;

// Triggered from PersonDetail's relationship-badge pencil icon (state owned
// here, mirroring how ConfirmDialog's shared state lives in App.jsx rather
// than inside PersonDetail itself). Saves a rule keyed on the relationship's
// SIGNATURE (see getRelationshipSignature in familyUtils.js), so the
// correction applies to every matching pair anywhere in the tree, not just
// the one being viewed right now.
export default function EditRelationshipDialog({ isOpen, subjectLabel, currentTerm, error, onSave, onCancel }) {
  const [term, setTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTerm(currentTerm || '');
      setShowSuggestions(false);
    }
  }, [isOpen, currentTerm]);

  // The save either closes this dialog (App.jsx clears editRelationshipState
  // on success) or hands back an error while staying open — either way, the
  // in-flight "Applying changes…" state is done.
  useEffect(() => {
    if (!isOpen || error) setSaving(false);
  }, [isOpen, error]);

  // Matches on EITHER the romanized spelling or the Tamil term itself, so
  // typing "peri" or pasting "பெரி" both work — a pure convenience layer,
  // not a constraint: whatever's in the field when Save is pressed is what
  // gets saved, suggestion picked or not.
  const suggestions = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return [];
    return TAMIL_RELATIONSHIP_TERMS.filter(
      (t) => t.en.toLowerCase().includes(query) || t.ta.includes(term.trim())
    ).slice(0, MAX_SUGGESTIONS);
  }, [term]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = term.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    onSave(trimmed);
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Edit relationship term" width={380} className="edit-relationship-dialog">
      <h3 className="edit-relationship-title">Edit relationship term</h3>
      {subjectLabel && <p className="edit-relationship-subject">{subjectLabel}</p>}
      <form onSubmit={handleSubmit}>
        <div className="edit-relationship-input-wrap">
          <input
            type="text"
            value={term}
            onChange={(e) => { setTerm(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Type in English or Tamil — e.g. Periyamma or அத்தை"
            autoFocus
            autoComplete="off"
            className="edit-relationship-input"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="edit-relationship-suggestions">
              {suggestions.map((t) => (
                <li key={t.ta}>
                  {/* onMouseDown (not onClick) fires before the input's blur
                      hides this list, same trick SearchBar.jsx uses. */}
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); setTerm(t.ta); setShowSuggestions(false); }}>
                    {t.en} <span className="edit-relationship-suggestion-ta">{t.ta}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="edit-relationship-hint">
          Applies to every pair anywhere in the tree with this same relationship pattern — not just this one.
        </p>
        {error && <p className="edit-relationship-error">Couldn't save: {error}</p>}
        <div className="edit-relationship-actions">
          <button type="button" className="edit-relationship-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className="edit-relationship-save" disabled={saving}>
            {saving ? (<><Loader2 size={14} className="edit-relationship-spinner" /> Applying changes…</>) : 'Save Rule'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
