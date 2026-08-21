import { describe, it, expect } from 'vitest';
import { createEmptyPerson, validateFamilyData } from './familyUtils.js';
import { exportGedcom, parseGedcom } from './gedcom.js';

function person(id, overrides = {}) {
  return { ...createEmptyPerson(id), id, ...overrides };
}

// A small couple with two children, wired symmetrically like the app stores it.
function sampleData() {
  return {
    rootPersonId: 'dad',
    persons: {
      dad: person('dad', { firstName: 'Kumar', lastName: 'Raj', gender: 'male', dob: '1960-06-14', spouseId: 'mom', marriageDate: '1985-02-10', childrenIds: ['son', 'dau'] }),
      mom: person('mom', { firstName: 'Meena', lastName: 'Raj', gender: 'female', dob: '1963', spouseId: 'dad', marriageDate: '1985-02-10', childrenIds: ['son', 'dau'] }),
      son: person('son', { firstName: 'Arjun', lastName: 'Kumar', gender: 'male', dob: '1988-11-02', isAlive: false, dod: '2020-01-05', parentIds: ['dad', 'mom'] }),
      dau: person('dau', { firstName: 'Priya', lastName: 'Kumar', gender: 'female', parentIds: ['dad', 'mom'] }),
    },
  };
}

describe('exportGedcom', () => {
  it('emits HEAD/INDI/FAM/TRLR with names, sex, dates and family links', () => {
    const ged = exportGedcom(sampleData());
    expect(ged).toMatch(/^0 HEAD/);
    expect(ged).toMatch(/0 TRLR$/);
    expect(ged).toContain('1 NAME Kumar /Raj/');
    expect(ged).toContain('1 SEX M');
    expect(ged).toContain('1 SEX F');
    expect(ged).toContain('2 DATE 14 JUN 1960');
    expect(ged).toContain('2 DATE 2 NOV 1988'); // son's birth
    expect(ged).toContain('1 DEAT'); // son deceased
    expect(ged).toContain('1 HUSB');
    expect(ged).toContain('1 WIFE');
    expect(ged).toContain('1 CHIL');
    expect(ged).toContain('1 MARR');
  });
});

describe('parseGedcom', () => {
  it('round-trips a family through export then import', () => {
    const original = sampleData();
    const ged = exportGedcom(original);
    const back = parseGedcom(ged);

    // Valid app data
    expect(validateFamilyData(back).valid).toBe(true);
    const people = Object.values(back.persons);
    expect(people).toHaveLength(4);

    const kumar = people.find((p) => p.firstName === 'Kumar');
    const meena = people.find((p) => p.firstName === 'Meena');
    const arjun = people.find((p) => p.firstName === 'Arjun');
    const priya = people.find((p) => p.firstName === 'Priya');

    // Genders + dates preserved
    expect(kumar.gender).toBe('male');
    expect(kumar.dob).toBe('1960-06-14');
    expect(meena.dob).toBe('1963'); // year-only survives
    expect(arjun.isAlive).toBe(false);
    expect(arjun.dod).toBe('2020-01-05');

    // Spouse link both ways
    expect(kumar.spouseId).toBe(meena.id);
    expect(meena.spouseId).toBe(kumar.id);
    expect(kumar.marriageDate).toBe('1985-02-10');

    // Children point to both parents; parents list both children
    expect(arjun.parentIds.sort()).toEqual([kumar.id, meena.id].sort());
    expect(priya.parentIds.sort()).toEqual([kumar.id, meena.id].sort());
    expect(kumar.childrenIds.sort()).toEqual([arjun.id, priya.id].sort());
  });

  it('parses a minimal external GEDCOM', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Smith/',
      '1 SEX M',
      '1 BIRT',
      '2 DATE 3 MAR 1950',
      '0 @I2@ INDI',
      '1 NAME Jane /Smith/',
      '1 SEX F',
      '0 @F1@ FAM',
      '1 HUSB @I1@',
      '1 WIFE @I2@',
      '1 CHIL @I3@',
      '0 @I3@ INDI',
      '1 NAME Baby /Smith/',
      '0 TRLR',
    ].join('\n');
    const data = parseGedcom(ged);
    expect(validateFamilyData(data).valid).toBe(true);
    const john = Object.values(data.persons).find((p) => p.firstName === 'John');
    const jane = Object.values(data.persons).find((p) => p.firstName === 'Jane');
    const baby = Object.values(data.persons).find((p) => p.firstName === 'Baby');
    expect(john.gender).toBe('male');
    expect(john.dob).toBe('1950-03-03');
    expect(john.spouseId).toBe(jane.id);
    expect(baby.parentIds.sort()).toEqual([john.id, jane.id].sort());
    // Missing SEX defaults to 'other'
    expect(baby.gender).toBe('other');
  });

  it('handles a single-parent family and unparseable/qualified dates', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME Solo /Parent/',
      '1 SEX F',
      '1 BIRT',
      '2 DATE ABT 1970',
      '0 @I2@ INDI',
      '1 NAME Kid /Parent/',
      '0 @F1@ FAM',
      '1 WIFE @I1@',
      '1 CHIL @I2@',
      '0 TRLR',
    ].join('\n');
    const data = parseGedcom(ged);
    expect(validateFamilyData(data).valid).toBe(true);
    const solo = Object.values(data.persons).find((p) => p.firstName === 'Solo');
    const kid = Object.values(data.persons).find((p) => p.firstName === 'Kid');
    expect(solo.dob).toBe('1970'); // "ABT 1970" -> "1970"
    expect(kid.parentIds).toEqual([solo.id]);
    expect(solo.childrenIds).toEqual([kid.id]);
  });
});
