import { useEffect, useState } from 'react';
import Modal from './Modal';
import '../styles/EditRelationshipDialog.css';

// Triggered from PersonDetail's relationship-badge pencil icon (state owned
// here, mirroring how ConfirmDialog's shared state lives in App.jsx rather
// than inside PersonDetail itself). Saves a rule keyed on the relationship's
// SIGNATURE (see getRelationshipSignature in familyUtils.js), so the
// correction applies to every matching pair anywhere in the tree, not just
// the one being viewed right now.
export default function EditRelationshipDialog({ isOpen, subjectLabel, currentTerm, error, onSave, onCancel }) {
  const [term, setTerm] = useState('');

  useEffect(() => {
    if (isOpen) setTerm(currentTerm || '');
  }, [isOpen, currentTerm]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = term.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Edit relationship term" width={380} className="edit-relationship-dialog">
      <h3 className="edit-relationship-title">Edit relationship term</h3>
      {subjectLabel && <p className="edit-relationship-subject">{subjectLabel}</p>}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="e.g. அத்தை"
          autoFocus
          className="edit-relationship-input"
        />
        <p className="edit-relationship-hint">
          Applies to every pair anywhere in the tree with this same relationship pattern — not just this one.
        </p>
        {error && <p className="edit-relationship-error">Couldn't save: {error}</p>}
        <div className="edit-relationship-actions">
          <button type="button" className="edit-relationship-cancel" onClick={onCancel}>Cancel</button>
          <button type="submit" className="edit-relationship-save">Save Rule</button>
        </div>
      </form>
    </Modal>
  );
}
