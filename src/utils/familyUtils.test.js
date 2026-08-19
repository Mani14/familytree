import { describe, it, expect } from 'vitest';
import {
  createEmptyPerson,
  getFullName,
  getInitials,
  getDisplayName,
  getSpouse,
  getParents,
  getChildren,
  getSiblings,
  getDaysUntilBirthday,
  getRelationshipLabel,
  getRelationshipLabelTamil,
} from './familyUtils.js';

// Builds a valid person (all required fields present via createEmptyPerson) with
// the given overrides — mirrors how useFamily stores records, so the relationship
// engine sees exactly the shape it does in the running app.
function person(id, overrides = {}) {
  return { ...createEmptyPerson(id), id, ...overrides };
}

// A small but complete three-generation family, wired symmetrically (every
// parentIds ↔ childrenIds and spouseId pair recorded on BOTH sides) the way the
// app's own mutators maintain it. Root of all relationship assertions is "me".
//
//        gpa ═ gma
//            │
//   mom ═════ dad ══ (parents of me/bro/sis)      uncle (dad's brother)
//            │
//     me ═ wife
//        │
//       son
function buildFamily() {
  const persons = {
    gpa: person('gpa', { firstName: 'Grand', lastName: 'Pa', gender: 'male', spouseId: 'gma', childrenIds: ['dad', 'uncle'] }),
    gma: person('gma', { firstName: 'Grand', lastName: 'Ma', gender: 'female', spouseId: 'gpa', childrenIds: ['dad', 'uncle'] }),
    dad: person('dad', { firstName: 'Da', lastName: 'D', gender: 'male', spouseId: 'mom', parentIds: ['gpa', 'gma'], childrenIds: ['me', 'bro', 'sis'] }),
    mom: person('mom', { firstName: 'Mo', lastName: 'M', gender: 'female', spouseId: 'dad', childrenIds: ['me', 'bro', 'sis'] }),
    uncle: person('uncle', { firstName: 'Un', lastName: 'Cle', gender: 'male', parentIds: ['gpa', 'gma'] }),
    me: person('me', { firstName: 'Me', lastName: 'Self', gender: 'male', spouseId: 'wife', parentIds: ['dad', 'mom'], childrenIds: ['son'] }),
    bro: person('bro', { firstName: 'Bro', lastName: 'Self', gender: 'male', parentIds: ['dad', 'mom'] }),
    sis: person('sis', { firstName: 'Sis', lastName: 'Self', gender: 'female', parentIds: ['dad', 'mom'] }),
    wife: person('wife', { firstName: 'Wi', lastName: 'Fe', gender: 'female', spouseId: 'me', childrenIds: ['son'] }),
    son: person('son', { firstName: 'So', lastName: 'N', gender: 'male', parentIds: ['me', 'wife'] }),
  };
  return persons;
}

describe('name helpers', () => {
  it('getFullName joins first and last, trimming', () => {
    expect(getFullName({ firstName: 'Ravi', lastName: 'Kumar' })).toBe('Ravi Kumar');
    expect(getFullName({ firstName: 'Ravi', lastName: '' })).toBe('Ravi');
    expect(getFullName(null)).toBe('');
  });

  it('getInitials uppercases first letters of each name', () => {
    expect(getInitials({ firstName: 'Ravi', lastName: 'Kumar' })).toBe('RK');
    expect(getInitials({ firstName: 'ravi', lastName: '' })).toBe('R');
    expect(getInitials(null)).toBe('?');
  });

  it('getDisplayName appends a pet name in brackets when present', () => {
    expect(getDisplayName({ firstName: 'Satish', lastName: 'Kumar', petName: 'Sambu' })).toBe('Satish Kumar (Sambu)');
    expect(getDisplayName({ firstName: 'Satish', lastName: 'Kumar', petName: '' })).toBe('Satish Kumar');
  });
});

describe('relationship reader helpers', () => {
  const persons = buildFamily();

  it('getSpouse returns the linked spouse', () => {
    expect(getSpouse(persons, persons.me)?.id).toBe('wife');
    expect(getSpouse(persons, persons.bro)).toBeNull();
  });

  it('getParents returns both recorded parents', () => {
    expect(getParents(persons, persons.me).map((p) => p.id).sort()).toEqual(['dad', 'mom']);
  });

  it('getChildren returns children in order', () => {
    expect(getChildren(persons, persons.dad).map((p) => p.id)).toEqual(['me', 'bro', 'sis']);
  });

  it('getSiblings excludes the person themselves', () => {
    expect(getSiblings(persons, persons.me).map((p) => p.id).sort()).toEqual(['bro', 'sis']);
  });
});

describe('getDaysUntilBirthday', () => {
  it('counts days to the next month/day occurrence', () => {
    const today = new Date(2020, 5, 10); // 10 Jun 2020
    expect(getDaysUntilBirthday('1990-06-15', today)).toBe(5);
  });

  it('returns 0 on the birthday itself', () => {
    const today = new Date(2020, 5, 10);
    expect(getDaysUntilBirthday('1990-06-10', today)).toBe(0);
  });

  it('rolls over to next year for a date already passed', () => {
    const today = new Date(2020, 5, 10);
    const days = getDaysUntilBirthday('1990-01-01', today);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(366);
  });

  it('returns null for missing/invalid input', () => {
    expect(getDaysUntilBirthday('')).toBeNull();
    expect(getDaysUntilBirthday('not-a-date')).toBeNull();
  });
});

describe('English relationship labels (relative to "me")', () => {
  const persons = buildFamily();
  const label = (id) => getRelationshipLabel(persons, id, 'me');

  it('direct blood relatives', () => {
    expect(label('dad')).toBe('Father');
    expect(label('mom')).toBe('Mother');
    expect(label('gpa')).toBe('Grandfather');
    expect(label('gma')).toBe('Grandmother');
    expect(label('bro')).toBe('Brother');
    expect(label('sis')).toBe('Sister');
    expect(label('son')).toBe('Son');
    expect(label('uncle')).toBe('Uncle');
  });

  it('spouse is labelled Spouse', () => {
    expect(label('wife')).toBe('Spouse');
  });

  it('a person has no relationship term to themselves', () => {
    expect(label('me')).toBeFalsy();
  });
});

describe('Tamil relationship labels (relative to "me")', () => {
  const persons = buildFamily();
  const label = (id) => getRelationshipLabelTamil(persons, id, 'me');

  it('direct blood relatives use the gendered Tamil term', () => {
    expect(label('dad')).toBe('அப்பா');
    expect(label('mom')).toBe('அம்மா');
    expect(label('gpa')).toBe('தாத்தா');
    expect(label('gma')).toBe('பாட்டி');
    expect(label('son')).toBe('மகன்');
  });

  it('a person has no relationship term to themselves', () => {
    expect(label('me')).toBeFalsy();
  });
});
