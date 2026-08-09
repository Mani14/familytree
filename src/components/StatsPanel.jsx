import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { Heart } from 'lucide-react';
import { computeFamilyStats, getDaysUntilBirthday, getForestRoots, getFullName } from '../utils/familyUtils';
import { computeForestLayout, NODE_H, V_GAP } from '../hooks/useTreeLayout';
import Modal from './Modal';
import '../styles/StatsPanel.css';

// Animates a stat card's number counting up to its real value instead of just
// appearing — from wherever it last landed (not always 0), so a value that
// changes while the panel happens to be open doesn't visibly reset partway
// through. Skips straight to the final value for reduced-motion users.
function CountUp({ value }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplay(value);
      prevRef.current = value;
      return undefined;
    }
    const controls = animate(prevRef.current, value, {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        prevRef.current = v;
        setDisplay(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, prefersReducedMotion]);

  return display;
}

// Generation index (0 = topmost row) for EVERY person, taken directly from Full
// Tree View's OWN row positions (computeForestLayout — the exact same layout the
// canvas renders from), not a separately-computed ancestor-distance. "Same
// generation" means "same horizontal line in the tree" — whatever two people
// share a row there is what this list should say too, so it can never disagree
// with what's actually on screen. Earlier attempts computed generation as
// distance from each branch's own recorded top ancestor, which meant simply
// recording one MORE ancestor above an existing chain — even with no new
// relationships to anyone else — silently pushed that whole branch's generation
// number down, purely as an artifact of how much history happens to be written
// down rather than any real change in who's related to whom. Reusing the
// rendered layout sidesteps that: a person's row is fixed by their depth below
// whichever root the canvas actually draws them under, unaffected by ancestors
// added ABOVE that root. collapsed is passed empty (not whatever the user has
// currently toggled in the visible tree) so every generation is fully expanded
// here regardless of what's collapsed on screen; excludeSatellites is off so
// nobody — including small bridged-in side-families the main view might hide —
// is left out of the count.
function computeGenerations(persons) {
  const gen = new Map();
  const layout = computeForestLayout(persons, getForestRoots(persons), new Set(), { excludeSatellites: false });
  const rowHeight = NODE_H + V_GAP;
  layout.nodes.forEach((node) => {
    const row = Math.round(node.y / rowHeight);
    gen.set(node.id, row);
    if (node.spouse) gen.set(node.spouse.id, row);
  });
  // Anyone the forest layout didn't place at all (shouldn't normally happen —
  // getForestRoots is meant to reach everyone) falls back to 0.
  Object.keys(persons).forEach((id) => {
    if (!gen.has(id)) gen.set(id, 0);
  });
  return gen;
}

const byName = (a, b) => getFullName(a).localeCompare(getFullName(b));

const ROMAN_NUMERALS = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
function toRoman(n) {
  let remaining = n;
  let result = '';
  for (const [value, symbol] of ROMAN_NUMERALS) {
    while (remaining >= value) {
      result += symbol;
      remaining -= value;
    }
  }
  return result;
}

// Detailed breakdown modal, opened from the header's stats icon. Every stat value is a
// link that reveals the actual people behind the number; clicking a name jumps to them.
export default function StatsPanel({ persons, isOpen, onClose, onSelect }) {
  const stats = useMemo(() => computeFamilyStats(persons), [persons]);
  const [openKey, setOpenKey] = useState(null);

  const lists = useMemo(() => {
    const all = Object.values(persons);
    const couples = [];
    const seen = new Set();
    for (const p of all) {
      if (p.spouseId && persons[p.spouseId]) {
        const key = [p.id, p.spouseId].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          couples.push([p, persons[p.spouseId]]);
        }
      }
    }
    const generationById = computeGenerations(persons);
    const generations = new Map();
    for (const p of all) {
      const g = generationById.get(p.id) ?? 0;
      if (!generations.has(g)) generations.set(g, []);
      generations.get(g).push(p);
    }
    const upcomingBirthdays = all
      .filter((p) => p.isAlive)
      .map((p) => ({ person: p, days: getDaysUntilBirthday(p.dob) }))
      .filter((entry) => entry.days != null)
      .sort((a, b) => a.days - b.days)
      .slice(0, 10);
    return {
      total: all,
      mapped: all.filter((p) => p.locationLat != null && p.locationLng != null),
      deceased: all.filter((p) => !p.isAlive),
      verified: all.filter((p) => p.verifiedEmail),
      males: all.filter((p) => p.gender === 'male'),
      females: all.filter((p) => p.gender === 'female'),
      other: all.filter((p) => p.gender !== 'male' && p.gender !== 'female'),
      couples,
      generations,
      upcomingBirthdays,
    };
  }, [persons]);

  const go = (id) => {
    onSelect?.(id);
    onClose?.();
  };

  const NameButton = ({ person }) => (
    <button type="button" className="stats-panel-name" onClick={() => go(person.id)}>
      {getFullName(person)}
    </button>
  );

  const NameList = ({ people }) => (
    <div className="stats-panel-names-list">
      {[...people].sort(byName).map((p) => (
        <NameButton key={p.id} person={p} />
      ))}
    </div>
  );

  const cards = [
    { key: 'total', value: stats.totalMembers, label: 'Total members' },
    { key: 'generations', value: stats.generationCount, label: 'Generations' },
    { key: 'couples', value: stats.marriedCouples, label: 'Married couples' },
    { key: 'mapped', value: stats.mapped, label: 'On the Map' },
    { key: 'deceased', value: stats.deceased, label: 'Deceased' },
    { key: 'verified', value: stats.verifiedProfiles, label: 'Verified profiles' },
  ];

  const toggle = (key) => setOpenKey((prev) => (prev === key ? null : key));

  const renderDetail = () => {
    if (!openKey) return null;
    if (openKey === 'couples') {
      return (
        <div className="stats-panel-names">
          <h3>Married couples</h3>
          <div className="stats-panel-names-list">
            {lists.couples
              .slice()
              .sort((a, b) => byName(a[0], b[0]))
              .map(([a, b]) => (
                <span key={a.id + b.id} className="stats-panel-couple">
                  <button type="button" className="stats-panel-name" onClick={() => go(a.id)}>{getFullName(a)}</button>
                  <Heart size={12} className="stats-panel-heart" fill="currentColor" />
                  <button type="button" className="stats-panel-name" onClick={() => go(b.id)}>{getFullName(b)}</button>
                </span>
              ))}
          </div>
        </div>
      );
    }
    if (openKey === 'generations') {
      const gens = [...lists.generations.entries()].sort((a, b) => a[0] - b[0]);
      return (
        <div className="stats-panel-names">
          <h3>By generation</h3>
          {gens.map(([g, people]) => (
            <div key={g} className="stats-panel-gen-group">
              <span className="stats-panel-gen-title">Generation {toRoman(g + 1)} <span className="stats-panel-count">{people.length}</span></span>
              <NameList people={people} />
            </div>
          ))}
        </div>
      );
    }
    const titles = { total: 'All members', mapped: 'On the Map', deceased: 'Deceased', verified: 'Verified profiles', males: 'Male', females: 'Female', other: 'Other' };
    return (
      <div className="stats-panel-names">
        <h3>{titles[openKey]}</h3>
        <NameList people={lists[openKey] || []} />
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Family Statistics" width="480px" className="stats-panel">
        <h2>Family Statistics</h2>

        <div className="stats-panel-grid">
          {cards.map(({ key, value, label }) => (
            <button
              key={key}
              type="button"
              className={`stats-panel-card${openKey === key ? ' is-open' : ''}`}
              onClick={() => toggle(key)}
            >
              <span className="stats-panel-value"><CountUp value={value} /></span>
              <span className="stats-panel-label">{label}</span>
            </button>
          ))}
        </div>

        <div className="stats-panel-row">
          <span className="stats-panel-row-label">By gender</span>
          <span>
            <button type="button" className="stats-panel-gender" onClick={() => toggle('males')}>{stats.males} male</button>
            {', '}
            <button type="button" className="stats-panel-gender" onClick={() => toggle('females')}>{stats.females} female</button>
            {stats.other ? (<>{', '}<button type="button" className="stats-panel-gender" onClick={() => toggle('other')}>{stats.other} other</button></>) : ''}
          </span>
        </div>

        {renderDetail()}

        {lists.upcomingBirthdays.length > 0 && (
          <div className="stats-panel-section">
            <h3>Upcoming birthdays <span className="stats-panel-count">{lists.upcomingBirthdays.length} people</span></h3>
            <ul className="stats-panel-birthdays">
              {lists.upcomingBirthdays.map(({ person, days }) => (
                <li key={person.id}>
                  <button type="button" className="stats-panel-name" onClick={() => go(person.id)}>{getFullName(person)}</button>
                  <span className="stats-panel-count">{days === 0 ? 'Today' : `${days}d`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

    </Modal>
  );
}
