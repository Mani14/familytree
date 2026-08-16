import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDaysUntilBirthday, getFullName } from '../utils/familyUtils';
import '../styles/BirthdayWidget.css';

const DEFAULT_WINDOW_DAYS = 30;
const DISMISS_KEY = 'family-hierarchy-birthday-dismissed';

export default function BirthdayWidget({ persons, onSelect, windowDays = DEFAULT_WINDOW_DAYS }) {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');

  const upcoming = useMemo(() => {
    const today = new Date();
    return Object.values(persons)
      .filter((person) => person.isAlive)
      .map((person) => ({ person, days: getDaysUntilBirthday(person.dob, today) }))
      .filter((entry) => entry.days != null && entry.days <= windowDays)
      .sort((a, b) => a.days - b.days);
  }, [persons, windowDays]);

  if (dismissed || upcoming.length === 0) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="birthday-widget">
      <span className="birthday-widget-icon" aria-hidden="true">🎂</span>
      <div className="birthday-widget-list">
        {upcoming.map(({ person, days }) => (
          <button
            key={person.id}
            type="button"
            className={`birthday-widget-item${days === 0 ? ' birthday-widget-item-today' : ''}`}
            onClick={() => onSelect(person.id)}
          >
            {days === 0 && (
              <span className="birthday-widget-bounce" aria-hidden="true">🎂</span>
            )}
            {getFullName(person)}
            {days === 0 ? "'s birthday is today!" : `'s birthday in ${days} day${days === 1 ? '' : 's'}`}
          </button>
        ))}
      </div>
      <button type="button" className="birthday-widget-close" onClick={dismiss} title="Dismiss" aria-label="Dismiss birthday reminders">
        <X size={15} />
      </button>
    </div>
  );
}
