import { useMemo, useState } from 'react';
import { ArrowDownUp, Cake, Cross, Heart } from 'lucide-react';
import { formatDateDisplay, getDisplayName } from '../utils/familyUtils';
import Modal from './Modal';
import '../styles/TimelinePanel.css';

const yearOf = (d) => {
  const m = /(\d{4})/.exec(d || '');
  return m ? Number(m[1]) : null;
};

// Builds the flat, dated event stream (births, marriages, deaths) from the tree.
// Marriages are emitted once per couple; every event carries a person to jump to.
function buildEvents(persons) {
  const events = [];
  const seenCouple = new Set();
  for (const p of Object.values(persons)) {
    if (p.isPlaceholder) continue;
    const birthY = yearOf(p.dob);
    if (birthY) events.push({ kind: 'birth', year: birthY, date: p.dob, personId: p.id, text: getDisplayName(p) });
    const deathY = yearOf(p.dod);
    if (deathY) events.push({ kind: 'death', year: deathY, date: p.dod, personId: p.id, text: getDisplayName(p) });
    if (p.spouseId && persons[p.spouseId] && p.marriageDate) {
      const key = [p.id, p.spouseId].sort().join('|');
      if (seenCouple.has(key)) continue;
      seenCouple.add(key);
      const mY = yearOf(p.marriageDate);
      if (mY) events.push({ kind: 'marriage', year: mY, date: p.marriageDate, personId: p.id, text: `${getDisplayName(p)} & ${getDisplayName(persons[p.spouseId])}` });
    }
  }
  return events;
}

const ICONS = { birth: Cake, marriage: Heart, death: Cross };
const VERB = { birth: 'Born', marriage: 'Married', death: 'Died' };

export default function TimelinePanel({ persons, isOpen, onClose, onSelect }) {
  const [newestFirst, setNewestFirst] = useState(false);

  const grouped = useMemo(() => {
    const events = buildEvents(persons);
    events.sort((a, b) => {
      const c = (a.date || '').localeCompare(b.date || '');
      return newestFirst ? -c : c;
    });
    const byYear = [];
    let current = null;
    for (const ev of events) {
      if (!current || current.year !== ev.year) {
        current = { year: ev.year, items: [] };
        byYear.push(current);
      }
      current.items.push(ev);
    }
    return byYear;
  }, [persons, newestFirst]);

  const total = useMemo(() => grouped.reduce((n, g) => n + g.items.length, 0), [grouped]);

  const go = (id) => {
    onSelect?.(id);
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Timeline" width="540px" className="timeline-panel">
      <div className="timeline-head">
        <h2>Timeline</h2>
        <button type="button" className="timeline-sort" onClick={() => setNewestFirst((v) => !v)}>
          <ArrowDownUp size={14} /> {newestFirst ? 'Newest first' : 'Oldest first'}
        </button>
      </div>
      {total === 0 ? (
        <p className="timeline-empty">No dated events yet — add birth, marriage, or death dates to see them here.</p>
      ) : (
        <div className="timeline">
          {grouped.map((group) => (
            <div key={group.year} className="timeline-year-group">
              <div className="timeline-year">{group.year}</div>
              <ul className="timeline-events">
                {group.items.map((ev, i) => {
                  const Icon = ICONS[ev.kind];
                  return (
                    <li key={`${ev.kind}-${ev.personId}-${i}`}>
                      <button type="button" onClick={() => go(ev.personId)}>
                        <span className={`timeline-icon timeline-icon-${ev.kind}`}><Icon size={13} /></span>
                        <span className="timeline-text">
                          <span className="timeline-verb">{VERB[ev.kind]}</span> {ev.text}
                        </span>
                        <span className="timeline-date">{formatDateDisplay(ev.date)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
