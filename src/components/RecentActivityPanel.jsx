import { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { getFullName } from '../utils/familyUtils';
import Modal from './Modal';
import '../styles/RecentActivityPanel.css';

// Admin-only "what changed lately" view over the shared, multi-editor tree —
// reads the lastEditedBy/lastEditedAt stamps useFamily writes on every add/edit
// (records predating that feature simply have no stamp and don't appear here).
const MAX_ROWS = 50;

function formatWhen(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function RecentActivityPanel({ persons, isOpen, onClose, onSelect }) {
  const rows = useMemo(
    () =>
      Object.values(persons)
        .filter((p) => p.lastEditedAt)
        .sort((a, b) => b.lastEditedAt - a.lastEditedAt)
        .slice(0, MAX_ROWS),
    [persons]
  );

  const handleSelect = (id) => {
    onSelect?.(id);
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Recent Activity" width="480px" className="recent-activity-panel">
      <h2><Clock size={18} /> Recent Activity</h2>
      {rows.length === 0 ? (
        <p className="recent-activity-empty">
          No edits recorded yet. As people are added or edited, the most recent changes show up here.
        </p>
      ) : (
        <ul className="recent-activity-list">
          {rows.map((p) => (
            <li key={p.id}>
              <button type="button" className="recent-activity-item" onClick={() => handleSelect(p.id)}>
                <span className="recent-activity-name">{getFullName(p)}</span>
                <span className="recent-activity-meta">
                  {formatWhen(p.lastEditedAt)}
                  {p.lastEditedBy ? ` · ${p.lastEditedBy}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
