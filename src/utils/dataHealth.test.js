import { describe, it, expect } from 'vitest';
import { createEmptyPerson } from './familyUtils.js';
import { runDataHealthCheck } from './dataHealth.js';

function person(id, overrides = {}) {
  return { ...createEmptyPerson(id), id, ...overrides };
}

const categories = (issues) => issues.map((i) => i.category);

describe('runDataHealthCheck — structural integrity', () => {
  it('reports no errors for a clean, symmetric family', () => {
    const persons = {
      a: person('a', { firstName: 'A', gender: 'male', spouseId: 'b', childrenIds: ['c'] }),
      b: person('b', { firstName: 'B', gender: 'female', spouseId: 'a', childrenIds: ['c'] }),
      c: person('c', { firstName: 'C', gender: 'male', parentIds: ['a', 'b'] }),
    };
    const errors = runDataHealthCheck(persons).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('flags a self-referential parent', () => {
    const persons = { a: person('a', { firstName: 'A', parentIds: ['a'] }) };
    expect(categories(runDataHealthCheck(persons))).toContain('Self-reference');
  });

  it('flags a dangling child reference', () => {
    const persons = { a: person('a', { firstName: 'A', childrenIds: ['ghost'] }) };
    expect(categories(runDataHealthCheck(persons))).toContain('Dangling reference');
  });
});

describe('runDataHealthCheck — duplicate-person detection', () => {
  it('flags two records with the same name AND the same birth date', () => {
    const persons = {
      a: person('a', { firstName: 'Ravi', lastName: 'Kumar', dob: '1980-01-01' }),
      b: person('b', { firstName: 'Ravi', lastName: 'Kumar', dob: '1980-01-01' }),
    };
    expect(categories(runDataHealthCheck(persons))).toContain('Possible duplicate person');
  });

  it('flags two same-name records that share a relative', () => {
    const persons = {
      parent: person('parent', { firstName: 'P', gender: 'male', childrenIds: ['a', 'b'] }),
      a: person('a', { firstName: 'Ravi', lastName: 'Kumar', parentIds: ['parent'] }),
      b: person('b', { firstName: 'Ravi', lastName: 'Kumar', parentIds: ['parent'] }),
    };
    expect(categories(runDataHealthCheck(persons))).toContain('Possible duplicate person');
  });

  it('does NOT flag same-name records with no corroborating signal (grandfather/grandson naming)', () => {
    const persons = {
      a: person('a', { firstName: 'Ravi', lastName: 'Kumar', dob: '1950-01-01' }),
      b: person('b', { firstName: 'Ravi', lastName: 'Kumar', dob: '1990-06-15' }),
    };
    expect(categories(runDataHealthCheck(persons))).not.toContain('Possible duplicate person');
  });

  it('does NOT flag placeholders or blank-named records', () => {
    const persons = {
      a: person('a', { firstName: 'Unknown', isPlaceholder: true, dob: '1980-01-01' }),
      b: person('b', { firstName: 'Unknown', isPlaceholder: true, dob: '1980-01-01' }),
    };
    expect(categories(runDataHealthCheck(persons))).not.toContain('Possible duplicate person');
  });
});
