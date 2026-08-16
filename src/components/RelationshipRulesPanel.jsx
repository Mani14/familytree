import { Languages, Trash2 } from 'lucide-react';
import Modal from './Modal';
import '../styles/RelationshipRulesPanel.css';

// Lists every custom Tamil relationship-term rule (see PersonDetail's edit
// affordance on the relationship badge, and getRelationshipSignature in
// familyUtils.js) — shared for everyone viewing the tree, so this list is
// also how a mistaken rule gets noticed and deleted quickly.
export default function RelationshipRulesPanel({ overrides, isOpen, onClose, onRemove, error }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Relationship Rules" width="480px" className="relationship-rules-panel">
      <h2><Languages size={18} /> Relationship Rules</h2>

      {error && <p className="relationship-rules-error">Couldn't save: {error}</p>}

      {overrides.length === 0 ? (
        <div className="relationship-rules-empty">
          <p>No custom terms yet — open the pencil icon next to any relationship badge to add one.</p>
        </div>
      ) : (
        <ul className="relationship-rules-list">
          {overrides.map((o) => (
            <li key={o.id} className="relationship-rules-item">
              <div className="relationship-rules-body">
                <p className="relationship-rules-label">{o.label}</p>
                <p className="relationship-rules-term">→ {o.term}</p>
              </div>
              <button
                type="button"
                className="relationship-rules-remove"
                onClick={() => onRemove(o.id)}
                aria-label="Delete rule"
                title="Delete rule"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
