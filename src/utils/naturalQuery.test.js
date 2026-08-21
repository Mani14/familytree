import { describe, it, expect } from 'vitest';
import { createEmptyPerson } from './familyUtils.js';
import { parseAddCommand, parseQuery, resolveAnswer } from './naturalQuery.js';
// Mirrors the app's stored record shape (see useFamily) so resolveAnswer sees
// exactly what it does at runtime.
function person(id, overrides = {}) {
  return { ...createEmptyPerson(id), id, ...overrides };
}

// A tiny fixture with a couple, their child, and a deliberate duplicate first
// name ("Ravi") to exercise the ambiguity path.
function fixture() {
  return {
    kumar: person('kumar', { firstName: 'Kumar', lastName: 'Raj', gender: 'male', spouseId: 'meena', childrenIds: ['ravi1'] }),
    meena: person('meena', { firstName: 'Meena', lastName: 'Raj', gender: 'female', spouseId: 'kumar', childrenIds: ['ravi1'] }),
    ravi1: person('ravi1', { firstName: 'Ravi', lastName: 'Kumar', gender: 'male', parentIds: ['kumar', 'meena'] }),
    ravi2: person('ravi2', { firstName: 'Ravi', lastName: 'Sundar', gender: 'male' }),
    solo: person('solo', { firstName: 'Solo', lastName: 'Singh', gender: 'male' }),
  };
}

describe('parseAddCommand', () => {
  it('parses "add <name> as <relation> of <target>"', () => {
    expect(parseAddCommand('add Arjun as son of Kumar')).toEqual({
      type: 'add-person', name: 'Arjun', relationWord: 'son', target: 'Kumar', action: 'child', gender: 'male',
    });
  });

  it('parses possessive target form "add <name> as <target>\'s <relation>"', () => {
    expect(parseAddCommand("add Latha as Kumar's wife")).toEqual({
      type: 'add-person', name: 'Latha', relationWord: 'wife', target: 'Kumar', action: 'spouse', gender: 'female',
    });
  });

  it('parses "add a <relation> named <name> to <target>"', () => {
    expect(parseAddCommand('add a daughter named Priya to Meena')).toEqual({
      type: 'add-person', name: 'Priya', relationWord: 'daughter', target: 'Meena', action: 'child', gender: 'female',
    });
  });

  it('parses bare "add <relation> <name> to <target>"', () => {
    expect(parseAddCommand('add brother Vijay to Ravi')).toEqual({
      type: 'add-person', name: 'Vijay', relationWord: 'brother', target: 'Ravi', action: 'sibling', gender: 'male',
    });
  });

  it('parses "add <target>\'s <relation> <name>"', () => {
    expect(parseAddCommand("add Kumar's father Raman")).toEqual({
      type: 'add-person', name: 'Raman', relationWord: 'father', target: 'Kumar', action: 'parent', gender: 'male',
    });
  });

  it('leaves gender unset for a generic relation word', () => {
    expect(parseAddCommand('add Sam as child of Kumar')).toMatchObject({ action: 'child', gender: null });
    expect(parseAddCommand('add Sam as spouse of Kumar')).toMatchObject({ action: 'spouse', gender: null });
  });

  it('accepts create/new/register verbs and multi-word names', () => {
    expect(parseAddCommand('create Ravi Kumar as son of Meena')).toMatchObject({ name: 'Ravi Kumar', action: 'child' });
    expect(parseAddCommand('register Anu as daughter of Kumar')).toMatchObject({ name: 'Anu', action: 'child' });
  });

  it('does NOT treat a question as an add command', () => {
    expect(parseAddCommand("who are Kumar's sons")).toBeNull();
    expect(parseAddCommand('how many sons does Kumar have')).toBeNull();
    expect(parseAddCommand('list Kumar children')).toBeNull();
  });

  it('returns null for an unknown relation word', () => {
    expect(parseAddCommand('add Ravi as friend of Kumar')).toBeNull();
    expect(parseAddCommand('add Ravi to Kumar')).toBeNull();
  });
});

describe('parseQuery routes add commands', () => {
  it('routes an add command through parseQuery', () => {
    expect(parseQuery('add Arjun as son of Kumar')).toMatchObject({ type: 'add-person', action: 'child' });
  });

  it('still routes a lookup question as relation-list, not add', () => {
    expect(parseQuery("who are Kumar's sons")).toMatchObject({ type: 'relation-list', relationWord: 'sons' });
  });

  it('routes an incomplete add ("add a new person") to guidance, not unknown', () => {
    expect(parseQuery('add a new person')).toMatchObject({ type: 'add-incomplete' });
    expect(parseQuery('add someone')).toMatchObject({ type: 'add-incomplete' });
    expect(parseQuery('add')).toMatchObject({ type: 'add-incomplete' });
    const res = resolveAnswer(fixture(), parseQuery('add a new person'));
    expect(res.kind).toBe('meta');
    expect(res.message).toMatch(/add Ravi as son of Kumar/i);
  });
});

describe('resolveAnswer add-person', () => {
  it('returns an add-confirm preview for an unambiguous target', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('add Arjun as son of Meena'));
    expect(res).toMatchObject({
      kind: 'add-confirm', action: 'child', relationWord: 'son', firstName: 'Arjun', gender: 'male',
    });
    expect(res.target.id).toBe('meena');
  });

  it('splits a multi-word name into first + last', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('add Deepa Nair as daughter of Kumar'));
    expect(res).toMatchObject({ kind: 'add-confirm', firstName: 'Deepa', lastName: 'Nair', gender: 'female' });
  });

  it('flags an unknown target', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('add Arjun as son of Nobody'));
    expect(res.kind).toBe('error');
  });

  it('asks to disambiguate when the target name is ambiguous', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('add Arjun as son of Ravi'));
    expect(res).toMatchObject({ kind: 'ambiguous', slot: 'target' });
    expect(res.candidates.map((p) => p.id).sort()).toEqual(['ravi1', 'ravi2']);
  });

  it('honours a chosen id for an ambiguous target', () => {
    const persons = fixture();
    const parsed = parseQuery('add Arjun as son of Ravi');
    const res = resolveAnswer(persons, parsed, { target: 'ravi2' });
    expect(res).toMatchObject({ kind: 'add-confirm', firstName: 'Arjun' });
    expect(res.target.id).toBe('ravi2');
  });

  it('blocks adding a spouse when one already exists', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('add Latha as wife of Kumar'));
    expect(res.kind).toBe('error');
    expect(res.message).toMatch(/already has a spouse/i);
  });

  it('blocks adding a parent when two already exist', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('add Raman as father of Ravi'), { target: 'ravi1' });
    expect(res.kind).toBe('error');
    expect(res.message).toMatch(/already has two parents/i);
  });

  it('allows adding a spouse to someone single', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('add Priya as wife of Solo'));
    expect(res).toMatchObject({ kind: 'add-confirm', action: 'spouse', gender: 'female' });
  });
});

describe('edit commands', () => {
  it('parses set-field variants', () => {
    expect(parseQuery("set Kumar's job to teacher")).toMatchObject({ type: 'edit-person', op: 'set-field', field: 'work', value: 'teacher' });
    expect(parseQuery('Meena lives in Chennai')).toMatchObject({ type: 'edit-person', op: 'set-field', field: 'location', value: 'Chennai' });
    expect(parseQuery('Kumar works as an engineer')).toMatchObject({ type: 'edit-person', op: 'set-field', field: 'work', value: 'engineer' });
    expect(parseQuery("change Meena's phone to 99999")).toMatchObject({ op: 'set-field', field: 'phone', value: '99999' });
  });

  it('parses and normalizes a date of birth', () => {
    expect(parseQuery("set Kumar's dob to 14 June 1960")).toMatchObject({ op: 'set-field', field: 'dob', value: '1960-06-14' });
    expect(parseQuery("set Kumar's birthday to 1960")).toMatchObject({ field: 'dob', value: '1960' });
  });

  it('parses deceased / alive / married commands', () => {
    expect(parseQuery('mark Kumar as deceased')).toMatchObject({ op: 'mark-deceased' });
    expect(parseQuery('Kumar passed away in 2020')).toMatchObject({ op: 'mark-deceased', date: '2020' });
    expect(parseQuery('mark Kumar as alive')).toMatchObject({ op: 'mark-alive' });
    expect(parseQuery('Solo married Priya on 2 Feb 2021')).toMatchObject({ op: 'set-married', nameA: 'Solo', nameB: 'Priya', date: '2021-02-02' });
  });

  it('does NOT treat questions as edit commands', () => {
    expect(parseQuery('who lives in Chennai').type).not.toBe('edit-person');
    expect(parseQuery('who works as a teacher').type).not.toBe('edit-person');
    expect(parseQuery('who is Kumar married to').type).toBe('relation-list');
  });

  it('resolves set-field to an edit-confirm', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery("set Kumar's job to teacher"));
    expect(res).toMatchObject({ kind: 'edit-confirm', op: 'set-field', field: 'work', value: 'teacher' });
    expect(res.person.id).toBe('kumar');
  });

  it('resolves mark-deceased with a date', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('mark Solo as deceased'));
    expect(res).toMatchObject({ kind: 'edit-confirm', op: 'mark-deceased' });
    expect(res.person.id).toBe('solo');
  });

  it('blocks marrying someone already married', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('Kumar married Solo'));
    expect(res.kind).toBe('error');
    expect(res.message).toMatch(/already has a spouse/i);
  });

  it('confirms a marriage between two single people', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery('Solo married Ravi'), { nameB: 'ravi2' });
    expect(res).toMatchObject({ kind: 'edit-confirm', op: 'set-married' });
    expect([res.personA.id, res.personB.id].sort()).toEqual(['ravi2', 'solo']);
  });

  it('rejects an unreadable date of birth', () => {
    const persons = fixture();
    const res = resolveAnswer(persons, parseQuery("set Kumar's dob to sometime"));
    expect(res.kind).toBe('error');
    expect(res.message).toMatch(/date/i);
  });
});
