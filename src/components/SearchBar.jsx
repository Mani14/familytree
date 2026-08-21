import { AnimatePresence, motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { getDisplayName } from '../utils/familyUtils';
import '../styles/SearchBar.css';

const MAX_RESULTS = 8;

// A one-line "1990 · Teacher · Chennai" hint under each result, so searching by
// job or place makes it obvious why someone matched.
const resultSubtext = (p) => {
  const bits = [];
  const year = (p.dob || '').slice(0, 4);
  if (year) bits.push(year);
  if (p.work) bits.push(p.work);
  if (p.location) bits.push(p.location.split(',')[0].trim());
  return bits.join(' · ');
};

export default function SearchBar({ persons, onLocate }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return Object.values(persons)
      .filter((person) => {
        if (person.isPlaceholder) return false;
        const hay = `${getDisplayName(person)} ${person.work || ''} ${person.location || ''}`.toLowerCase();
        return hay.includes(term);
      })
      .slice(0, MAX_RESULTS);
  }, [persons, query]);

  const select = (id) => {
    onLocate(id);
    setQuery('');
    setIsOpen(false);
    // Drop focus so the mobile keyboard closes after choosing a result.
    inputRef.current?.blur();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setQuery('');
      setIsOpen(false);
    } else if (e.key === 'Enter' && matches.length > 0) {
      select(matches[0].id);
    }
  };

  return (
    <div className="search-bar">
      <Search size={14} className="search-bar-icon" />
      <input
        ref={inputRef}
        type="text"
        className="search-bar-input"
        placeholder="Search by name, job, or place…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        onKeyDown={handleKeyDown}
      />
      <AnimatePresence>
        {isOpen && query.trim() && (
          <motion.ul
            className="search-bar-results glass-surface"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          >
            {matches.length > 0 ? (
              matches.map((person) => (
                <li key={person.id} className="search-bar-result-row">
                  {/* onMouseDown (not onClick) fires before the input's blur closes the
                      dropdown, so a tap always registers instead of occasionally missing. */}
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(person.id);
                    }}
                    title="Focus this person"
                  >
                    <span className="search-bar-result-name">{getDisplayName(person)}</span>
                    {resultSubtext(person) && <span className="search-bar-result-sub">{resultSubtext(person)}</span>}
                  </button>
                </li>
              ))
            ) : (
              <li className="search-bar-empty">No matches</li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
