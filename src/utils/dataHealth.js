import { getFullName } from './familyUtils';

// Pure detection only — no mutation happens here. Each issue optionally carries a
// `fix` descriptor ({ action, label, ...ids }) that DataHealthPanel interprets and
// applies via updatePerson, always reading the LIVE persons object at click time
// (not a value snapshotted when the issue was first detected) so a fix is never
// computed against stale data if something else changed while the panel was open.
function findDuplicates(arr) {
  const seen = new Set();
  const dupes = new Set();
  arr.forEach((v) => {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  });
  return [...dupes];
}

const name = (persons, id) => (persons[id] ? getFullName(persons[id]) : 'Someone');

export function runDataHealthCheck(persons) {
  const issues = [];
  const ids = Object.keys(persons);

  for (const id of ids) {
    const person = persons[id];

    // Self-references — always a data error, never legitimate.
    if (person.parentIds.includes(id)) {
      issues.push({
        id: `self-parent-${id}`,
        severity: 'error',
        category: 'Self-reference',
        message: `${name(persons, id)} is listed as their own parent.`,
        personIds: [id],
        fix: { action: 'removeSelfParent', label: 'Remove', personId: id },
      });
    }
    if (person.childrenIds.includes(id)) {
      issues.push({
        id: `self-child-${id}`,
        severity: 'error',
        category: 'Self-reference',
        message: `${name(persons, id)} is listed as their own child.`,
        personIds: [id],
        fix: { action: 'removeSelfChild', label: 'Remove', personId: id },
      });
    }
    if (person.spouseId === id) {
      issues.push({
        id: `self-spouse-${id}`,
        severity: 'error',
        category: 'Self-reference',
        message: `${name(persons, id)} is listed as their own spouse.`,
        personIds: [id],
        fix: { action: 'removeSelfSpouse', label: 'Remove', personId: id },
      });
    }

    // More than 2 recorded parents — the app's own UI never allows this, so it can
    // only happen from a manual data edit; flag but don't guess which one to drop.
    if (person.parentIds.length > 2) {
      issues.push({
        id: `too-many-parents-${id}`,
        severity: 'error',
        category: 'Too many parents',
        message: `${name(persons, id)} has ${person.parentIds.length} recorded parents — should be at most 2.`,
        personIds: [id, ...person.parentIds],
        fix: null,
      });
    }

    // Dangling references — the id is recorded but the person no longer exists
    // (e.g. deleted without cleaning up who pointed at them).
    person.parentIds.forEach((pid) => {
      if (!persons[pid]) {
        issues.push({
          id: `dangling-parent-${id}-${pid}`,
          severity: 'error',
          category: 'Dangling reference',
          message: `${name(persons, id)} lists a parent that no longer exists in the tree.`,
          personIds: [id],
          fix: { action: 'removeDanglingParent', label: 'Remove reference', personId: id, missingId: pid },
        });
      }
    });
    person.childrenIds.forEach((cid) => {
      if (!persons[cid]) {
        issues.push({
          id: `dangling-child-${id}-${cid}`,
          severity: 'error',
          category: 'Dangling reference',
          message: `${name(persons, id)} lists a child that no longer exists in the tree.`,
          personIds: [id],
          fix: { action: 'removeDanglingChild', label: 'Remove reference', personId: id, missingId: cid },
        });
      }
    });
    if (person.spouseId && !persons[person.spouseId]) {
      issues.push({
        id: `dangling-spouse-${id}`,
        severity: 'error',
        category: 'Dangling reference',
        message: `${name(persons, id)} is linked to a spouse who no longer exists in the tree.`,
        personIds: [id],
        fix: { action: 'removeDanglingSpouse', label: 'Remove reference', personId: id },
      });
    }

    // Duplicate entries within the same array — always safe to dedupe, never
    // represents two genuinely distinct relationships.
    if (findDuplicates(person.parentIds).length) {
      issues.push({
        id: `dup-parent-${id}`,
        severity: 'warning',
        category: 'Duplicate entry',
        message: `${name(persons, id)}'s parent list has the same person recorded twice.`,
        personIds: [id],
        fix: { action: 'dedupeParents', label: 'Remove duplicate', personId: id },
      });
    }
    if (findDuplicates(person.childrenIds).length) {
      issues.push({
        id: `dup-child-${id}`,
        severity: 'warning',
        category: 'Duplicate entry',
        message: `${name(persons, id)}'s child list has the same person recorded twice.`,
        personIds: [id],
        fix: { action: 'dedupeChildren', label: 'Remove duplicate', personId: id },
      });
    }
  }

  // Asymmetric links — one side records the relationship, the other doesn't. This
  // is the exact shape of bug that silently breaks jump badges / bridges: e.g. a
  // parent-unlink that only cleared one side, leaving the other stale.
  const seenSpousePairs = new Set();
  for (const id of ids) {
    const person = persons[id];

    person.parentIds.forEach((pid) => {
      const parent = persons[pid];
      if (parent && !parent.childrenIds.includes(id)) {
        issues.push({
          id: `asym-pc-${pid}-${id}`,
          severity: 'warning',
          category: 'Asymmetric link',
          message: `${name(persons, id)} lists ${name(persons, pid)} as a parent, but ${name(persons, pid)} doesn't list ${name(persons, id)} back as a child.`,
          personIds: [id, pid],
          fix: { action: 'addChildBackLink', label: 'Add missing back-link', parentId: pid, childId: id },
        });
      }
    });

    person.childrenIds.forEach((cid) => {
      const child = persons[cid];
      if (child && !child.parentIds.includes(id)) {
        issues.push({
          id: `asym-cp-${id}-${cid}`,
          severity: 'warning',
          category: 'Asymmetric link',
          message: `${name(persons, id)} lists ${name(persons, cid)} as a child, but ${name(persons, cid)} doesn't list ${name(persons, id)} back as a parent.`,
          personIds: [id, cid],
          fix:
            child.parentIds.length < 2
              ? { action: 'addParentBackLink', label: 'Add missing back-link', childId: cid, parentId: id }
              : null,
        });
      }
    });

    if (person.spouseId && persons[person.spouseId]) {
      const spouse = persons[person.spouseId];
      const pairKey = [id, person.spouseId].sort().join('|');
      if (spouse.spouseId !== id && !seenSpousePairs.has(pairKey)) {
        seenSpousePairs.add(pairKey);
        issues.push({
          id: `asym-spouse-${pairKey}`,
          severity: 'warning',
          category: 'Asymmetric link',
          message: spouse.spouseId
            ? `${name(persons, id)} lists ${name(persons, person.spouseId)} as their spouse, but ${name(persons, person.spouseId)} is linked to someone else instead.`
            : `${name(persons, id)} lists ${name(persons, person.spouseId)} as their spouse, but it's not recorded the other way round.`,
          personIds: [id, person.spouseId],
          fix: spouse.spouseId
            ? null
            : { action: 'syncSpouseLink', label: 'Add missing back-link', personId: id, spouseId: person.spouseId },
        });
      }
    }
  }

  // Same-gender spouse pairs — usually a Gender field typo on one side rather than
  // an intentional same-sex marriage, and it silently breaks the Tamil in-law terms
  // that assume an opposite-gender spouse (e.g. tamilCrossCousinSpouseTerm) — those
  // now return no term at all rather than a confidently wrong one once genders
  // don't match, which is what actually surfaces this as a badge going blank. Info
  // severity, no auto-fix, since only a human knows which person's Gender is wrong.
  const seenGenderPairs = new Set();
  for (const id of ids) {
    const person = persons[id];
    if (person.spouseId && persons[person.spouseId] && person.gender && person.gender === persons[person.spouseId].gender) {
      const pairKey = [id, person.spouseId].sort().join('|');
      if (!seenGenderPairs.has(pairKey)) {
        seenGenderPairs.add(pairKey);
        issues.push({
          id: `same-gender-spouses-${pairKey}`,
          severity: 'info',
          category: 'Same-gender spouses',
          message: `${name(persons, id)} and ${name(persons, person.spouseId)} are recorded as spouses with the same gender (${person.gender}) — double-check both people's Gender field if that's not intentional.`,
          personIds: [id, person.spouseId],
          fix: null,
        });
      }
    }
  }

  // Informational only — not broken, just unfinished (see useFamily's addSibling).
  for (const id of ids) {
    const person = persons[id];
    if (person.isPlaceholder) {
      const kids = person.childrenIds.filter((cid) => persons[cid]).map((cid) => name(persons, cid));
      issues.push({
        id: `placeholder-${id}`,
        severity: 'info',
        category: 'Incomplete placeholder',
        message: `An "Unknown Parent" placeholder for ${kids.join(' & ') || 'someone'} was never filled in.`,
        personIds: [id, ...person.childrenIds.filter((cid) => persons[cid])],
        fix: null,
      });
    }
  }

  // Likely duplicate people — the same relative added twice by different branches
  // of a shared, multi-editor tree. A name match ALONE is far too noisy here (Tamil
  // families routinely name a child after a living grandparent), so a pair is only
  // flagged when the name is corroborated by a second signal: an identical recorded
  // birth date, or at least one shared relative (parent/child/spouse) — the
  // fingerprint of two records describing one real person. Info severity, no
  // auto-fix: merging two people is destructive and only a human can confirm it.
  const normName = (p) => `${p.firstName || ''} ${p.lastName || ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
  const relativesOf = (p) => new Set([...p.parentIds, ...p.childrenIds, ...(p.spouseId ? [p.spouseId] : [])]);
  const byName = new Map();
  for (const id of ids) {
    const person = persons[id];
    if (person.isPlaceholder || !person.firstName.trim()) continue;
    const key = normName(person);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(id);
  }
  const seenDupePairs = new Set();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = persons[group[i]];
        const b = persons[group[j]];
        const sameDob = a.dob && b.dob && a.dob === b.dob;
        const relA = relativesOf(a);
        const sharesRelative = [...relativesOf(b)].some((rid) => relA.has(rid));
        if (!sameDob && !sharesRelative) continue;
        const pairKey = [group[i], group[j]].sort().join('|');
        if (seenDupePairs.has(pairKey)) continue;
        seenDupePairs.add(pairKey);
        const reason = sameDob ? 'the same birth date' : 'a shared relative';
        issues.push({
          id: `dup-person-${pairKey}`,
          severity: 'info',
          category: 'Possible duplicate person',
          message: `${getFullName(a)} appears twice — two records share the same name and ${reason}. If they're the same person, copy any details onto one and delete the other.`,
          personIds: [group[i], group[j]],
          fix: null,
        });
      }
    }
  }

  return issues;
}
