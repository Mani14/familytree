import { useMemo } from 'react';
import { Languages, Pencil, Trash2 } from 'lucide-react';
import { getRelationshipLabelTamil, getRelationshipSignature } from '../utils/familyUtils';
import { REFERENCE_RELATIONSHIPS } from '../utils/relationshipReference';
import Modal from './Modal';
import '../styles/RelationshipRulesPanel.css';

// Groups the reference rows by category, preserving REFERENCE_RELATIONSHIPS'
// own first-seen order (not alphabetical) — the file's own grouping is
// already the intended reading order (parents before cousins before in-laws).
function groupByCategory(rows) {
  const groups = [];
  const byCategory = new Map();
  rows.forEach((row) => {
    if (!byCategory.has(row.category)) {
      const group = { category: row.category, rows: [] };
      byCategory.set(row.category, group);
      groups.push(group);
    }
    byCategory.get(row.category).rows.push(row);
  });
  return groups;
}

// Lists every custom Tamil relationship-term rule (see PersonDetail's edit
// affordance on the relationship badge, and getRelationshipSignature in
// familyUtils.js) — shared for everyone viewing the tree, so this list is
// also how a mistaken rule gets noticed and deleted quickly. Below that, a
// browsable reference of every DEFAULT term the engine computes (via a small
// representative sample family per relationship — see relationshipReference.js)
// — reusing the exact same getRelationshipLabelTamil/getRelationshipSignature
// calls the real tree uses, so this table can never drift from what the app
// actually shows, and each row is editable the same way a live badge is.
export default function RelationshipRulesPanel({ overrides, isOpen, onClose, onRemove, onEditReference, error }) {
  const referenceGroups = useMemo(() => {
    if (!isOpen) return [];
    const rows = REFERENCE_RELATIONSHIPS.map((row) => ({
      ...row,
      term: getRelationshipLabelTamil(row.persons, row.personId, row.rootId, overrides),
      signature: getRelationshipSignature(row.persons, row.personId, row.rootId),
    }));
    return groupByCategory(rows);
  }, [isOpen, overrides]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Relationship Rules" width="560px" className="relationship-rules-panel">
      <h2><Languages size={18} /> Relationship Rules</h2>

      {error && <p className="relationship-rules-error">Couldn't save: {error}</p>}

      <section className="relationship-rules-section">
        <h3 className="relationship-rules-section-title">Your Custom Rules</h3>
        {overrides.length === 0 ? (
          <div className="relationship-rules-empty">
            <p>No custom terms yet — use the pencil icon on any relationship badge or row below to add one.</p>
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
      </section>

      {onEditReference && (
        <section className="relationship-rules-section">
          <h3 className="relationship-rules-section-title">All Relationships</h3>
          <div className="relationship-rules-reference">
            {referenceGroups.map((group) => (
              <div key={group.category} className="relationship-rules-group">
                <p className="relationship-rules-group-title">{group.category}</p>
                <ul className="relationship-rules-list">
                  {group.rows.map((row) => (
                    <li key={row.description} className="relationship-rules-item">
                      <div className="relationship-rules-body">
                        <p className="relationship-rules-label">{row.description}</p>
                        <p className="relationship-rules-term">→ {row.term || '—'}</p>
                      </div>
                      {row.signature && (
                        <button
                          type="button"
                          className="relationship-rules-edit"
                          onClick={() => onEditReference(row.signature, row.term, row.description)}
                          aria-label={`Edit ${row.description}`}
                          title="Edit this default term"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </Modal>
  );
}
