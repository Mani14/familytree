// Pure helpers for reading relationships and derived person data.
// All functions take the `persons` map (id -> person) and never mutate it.

export function getPerson(persons, id) {
  if (!id) return null;
  return persons[id] || null;
}

// App-wide rule: in a rendered couple pairing, male always goes on the left, female
// always on the right — a fixed, gender-only fact about the two people involved, not
// tied to who's "primary" (the blood descendant the layout recursed through) vs.
// "spouse" (married in), and never affected by who's currently focused/clicked, so
// it can't flip mid-session. Only the one combination that would otherwise violate
// it (person female, spouse male) flips the default "primary renders first" order;
// every other combination (male+female already correct, both same gender, or
// unknown/other) keeps that default, since there's no clear male/female distinction
// to enforce there. Every place that lays out or targets a specific side of a couple
// (TreeNode's render order, the connector-line/cross-link X offsets, centring on a
// specific person) must go through this so the two can never disagree.
export function isPrimaryOnLeft(person, spouse) {
  if (!spouse) return true;
  if (person?.gender === 'female' && spouse?.gender === 'male') return false;
  return true;
}

export function getSpouse(persons, person) {
  if (!person || !person.spouseId) return null;
  return getPerson(persons, person.spouseId);
}

export function getParents(persons, person) {
  if (!person) return [];
  return person.parentIds.map((id) => getPerson(persons, id)).filter(Boolean);
}

export function getChildren(persons, person) {
  if (!person) return [];
  return person.childrenIds.map((id) => getPerson(persons, id)).filter(Boolean);
}

// Siblings share at least one parent, excluding the person themselves.
export function getSiblings(persons, person) {
  if (!person || person.parentIds.length === 0) return [];
  const parentSet = new Set(person.parentIds);
  const seen = new Set();
  const siblings = [];
  for (const parentId of person.parentIds) {
    const parent = getPerson(persons, parentId);
    if (!parent) continue;
    for (const childId of parent.childrenIds) {
      if (childId === person.id || seen.has(childId)) continue;
      const child = getPerson(persons, childId);
      if (!child) continue;
      // Only count as sibling if they share a parent (always true here).
      if (child.parentIds.some((pid) => parentSet.has(pid))) {
        seen.add(childId);
        siblings.push(child);
      }
    }
  }
  return siblings;
}

// True when a parentless person is merely attached-by-marriage to someone else's
// blood line (their spouse has recorded parents), rather than being the top of
// their own lineage. Such a person shouldn't get their own tree — they're drawn
// as an attached spouse card wherever their blood-relative partner appears.
function isMarriedIn(persons, person) {
  if (!person || person.parentIds.length > 0) return false;
  const spouse = getPerson(persons, person.spouseId);
  return !!spouse && spouse.parentIds.length > 0;
}

function collectAncestorIds(persons, id, visited = new Set()) {
  const person = getPerson(persons, id);
  if (!person) return visited;
  for (const parentId of person.parentIds) {
    if (visited.has(parentId)) continue;
    visited.add(parentId);
    collectAncestorIds(persons, parentId, visited);
  }
  return visited;
}

function collectDescendantIds(persons, id, visited = new Set()) {
  const person = getPerson(persons, id);
  if (!person) return visited;
  for (const childId of person.childrenIds) {
    if (visited.has(childId)) continue;
    visited.add(childId);
    collectDescendantIds(persons, childId, visited);
  }
  return visited;
}

// Which already-recorded people are safe to attach as `relation`
// ('parent'|'spouse'|'child'|'sibling') of personId instead of creating a new
// person — used by PersonForm's "Link Existing" tab. Excludes personId's own
// ancestors/descendants (would create a cycle), placeholders (fill those in
// directly instead), and anyone already in that exact role.
export function getEligibleLinkCandidates(persons, personId, relation) {
  const person = getPerson(persons, personId);
  if (!person) return [];

  const ancestorIds = collectAncestorIds(persons, personId);
  const descendantIds = collectDescendantIds(persons, personId);

  return Object.values(persons).filter((candidate) => {
    if (candidate.id === personId || candidate.isPlaceholder) return false;

    switch (relation) {
      case 'spouse':
        return !candidate.spouseId && !ancestorIds.has(candidate.id) && !descendantIds.has(candidate.id);
      case 'parent':
        return (
          !person.parentIds.includes(candidate.id) &&
          candidate.id !== person.spouseId &&
          !descendantIds.has(candidate.id)
        );
      case 'child':
        return (
          !person.childrenIds.includes(candidate.id) &&
          candidate.id !== person.spouseId &&
          candidate.parentIds.length < 2 &&
          !ancestorIds.has(candidate.id)
        );
      case 'sibling':
        return candidate.parentIds.length === 0 && candidate.id !== person.spouseId;
      default:
        return false;
    }
  });
}

// Counts a person's full blood-descendant closure (via childrenIds only), used to
// rank family clusters so the larger lineage claims any shared descendants first
// when two families are linked by a marriage deep inside both trees.
export function countDescendants(persons, id, visited = new Set()) {
  if (visited.has(id)) return 0;
  visited.add(id);
  const person = persons[id];
  if (!person) return 0;
  let count = 1;
  for (const childId of person.childrenIds) {
    count += countDescendants(persons, childId, visited);
  }
  return count;
}

// Walks up via parentIds[0] to the top of a person's primary blood line. When a
// person has two lineages feeding into them (e.g. a descendant of family A married
// a descendant of family B), this resolves the tie by treating parentIds[0]'s side
// as "primary" — used to decide which lineage should visually own shared descendants.
export function primaryLineageRoot(persons, id) {
  let current = getPerson(persons, id);
  if (!current) return id;
  const visited = new Set();
  while (current.parentIds.length > 0 && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = getPerson(persons, current.parentIds[0]);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

// Resolves a person's father-side and mother-side lineage roots (their whole
// blood families' respective tops) — used both by computePedigreeLayout (which
// two trees to render, father's on the left) and by the dad-side/mom-side
// highlight coloring (which tree a node came from). Identified by GENDER, not
// parentIds array position — parentIds[0] is birth order/entry order (whichever
// parent was recorded first), not reliably "the father," so a person whose
// mother happened to be entered first would otherwise get their whole paternal
// lineage mislabeled as "mother" (wrong tint color, and swapped left/right in
// Pedigree View). Falls back to array order only when gender can't disambiguate
// (e.g. both parents recorded as the same gender, or unknown).
export function getLineageRootIds(persons, personId) {
  const person = getPerson(persons, personId);
  if (!person) return { fatherRootId: null, motherRootId: null };
  const parents = (person.parentIds || []).map((pid) => persons[pid]).filter(Boolean);
  const father = parents.find((p) => p.gender === 'male') || parents[0] || null;
  const mother = parents.find((p) => p.gender === 'female' && p.id !== father?.id) || parents.find((p) => p.id !== father?.id) || null;
  const fatherRootId = father ? primaryLineageRoot(persons, father.id) : null;
  const motherRootId = mother ? primaryLineageRoot(persons, mother.id) : null;
  return { fatherRootId, motherRootId };
}

// Every ancestor id reachable by walking BOTH recorded parents upward from `id`
// (not just parentIds[0]'s primary line) — e.g. for Manikandan this includes both
// his father's whole ancestry and his mother's, including Kasi via Vanaja. Used to
// tell "this bridged family is one of the root person's own blood lines" (always
// shown in full, e.g. Kasi's family, however large it grows) apart from "this
// bridged family is purely a spouse's own relatives" (a satellite candidate, e.g.
// Sofiya's parents' side) — see computeForestLayout's satellite exclusion.
export function getBloodAncestorIds(persons, id) {
  const result = new Set();
  const stack = [id];
  while (stack.length) {
    const curId = stack.pop();
    const cur = persons[curId];
    if (!cur) continue;
    (cur.parentIds || []).forEach((pid) => {
      if (!result.has(pid)) {
        result.add(pid);
        stack.push(pid);
      }
    });
  }
  return result;
}

// Finds every distinct top-of-lineage person/couple (no recorded parents, and not
// merely married into someone else's blood line) so each gets its own tree in the
// rendered forest. Two families can still be linked deep inside by a marriage (e.g.
// a daughter of one lineage marries a descendant of another) without one silently
// swallowing the other — computeForestLayout resolves the shared descendants.
// Sorted by lineage size (largest first) so the bigger family claims them, except
// `priorityId`'s own lineage always wins ownership of any shared descendant it's
// linked to (e.g. Kesavamoorthy/Vanaja), regardless of relative size — not just
// ties. Callers MUST pass a stable anchor here (e.g. App.jsx's persisted
// rootPersonId), never a transient focus/selection: keying this to whoever the user
// currently happens to be looking at would let ownership of a shared branch flip
// mid-session depending on click history, and — worse — if focus ever lands on
// someone whose lineage traces to a tiny satellite cluster (e.g. Sridhar, whose
// lineage is the 5-person "unknownMalar" family), that tiny cluster would jump the
// queue and steal a shared descendant (e.g. Sowmiya) away from the real family that
// should own her, then vanish her entirely once the cluster is excluded as a
// satellite. Anchoring to the app's stable root person (whose own lineage is a
// real, substantial family) avoids both problems.
export function getForestRoots(persons, priorityId) {
  const candidates = [];
  const skip = new Set();
  for (const id of Object.keys(persons)) {
    if (skip.has(id)) continue;
    const person = persons[id];
    if (person.parentIds.length > 0) continue; // not top-of-lineage
    if (isMarriedIn(persons, person)) continue; // attached to a blood line elsewhere

    const spouse = getPerson(persons, person.spouseId);
    if (spouse && spouse.parentIds.length === 0 && !isMarriedIn(persons, spouse)) {
      // Genuine top couple (neither has known parents) — pick one canonical
      // representative so they don't each spawn their own duplicate tree.
      const child = person.childrenIds.map((cid) => getPerson(persons, cid)).find(Boolean);
      const canonical = child && child.parentIds[0] === spouse.id ? spouse.id : id;
      skip.add(canonical === id ? spouse.id : id);
      candidates.push(canonical);
    } else {
      candidates.push(id);
    }
  }
  const roots = [...new Set(candidates)].sort(
    (a, b) => countDescendants(persons, b) - countDescendants(persons, a)
  );
  const priorityRoot = priorityId ? primaryLineageRoot(persons, priorityId) : null;
  const priorityIndex = priorityRoot ? roots.indexOf(priorityRoot) : -1;
  if (priorityIndex > 0) {
    roots.splice(priorityIndex, 1);
    roots.unshift(priorityRoot);
  }
  return roots;
}

// Finds cross-family marriage bridges between forest roots — e.g. Kesavamoorthy
// (a Subramanian descendant) marrying Vanaja (a Kasi descendant) links those two
// otherwise-separate trees. For each root, walks its own blood descent (one DFS
// per direct child, so we know which top-level branch to reorder later) and
// checks every descendant's spouse: if that spouse has recorded parents whose
// lineage traces to a *different* root also in this forest, that's a bridge.
// Returns one entry per unordered root pair, each side tagged with its own
// branch id (the direct child of that root leading to the bridge) so the layout
// can move that branch to whichever edge faces the other root.
export function findRootBridges(persons, roots) {
  const rootSet = new Set(roots);
  const byRoot = new Map(roots.map((r) => [r, new Map()])); // rootId -> otherRootId -> {branchId, weight}

  roots.forEach((rootId) => {
    const root = getPerson(persons, rootId);
    if (!root) return;
    root.childrenIds.forEach((branchId) => {
      if (!persons[branchId]) return;
      const visited = new Set();
      // Carries the full chain of ids from the root's direct child down to whoever
      // actually does the bridging — not just that direct child — so a root whose
      // bridging descendant is several generations down (e.g. a new ancestor added
      // above what used to be the root) can still have EVERY level along the way
      // reordered to face the neighbour, not just the root's own immediate child.
      const stack = [{ id: branchId, path: [branchId] }];
      while (stack.length) {
        const { id: curId, path } = stack.pop();
        if (visited.has(curId) || !persons[curId]) continue;
        visited.add(curId);
        const cur = persons[curId];
        const spouse = getPerson(persons, cur.spouseId);
        if (spouse && spouse.parentIds.length > 0) {
          const otherRoot = primaryLineageRoot(persons, spouse.id);
          if (otherRoot !== rootId && rootSet.has(otherRoot)) {
            const weight = countDescendants(persons, otherRoot);
            const existing = byRoot.get(rootId).get(otherRoot);
            if (!existing || weight > existing.weight) {
              // Genders of the actual bridging couple (not just the branch/ancestor
              // id), so orderRootsForBridges can put the husband's side on the left.
              byRoot.get(rootId).set(otherRoot, { branchId, path, weight, selfGender: cur.gender, spouseGender: spouse.gender });
            }
          }
        }
        cur.childrenIds.forEach((c) => stack.push({ id: c, path: [...path, c] }));
      }
    });
  });

  const seenPairs = new Set();
  const bridges = [];
  roots.forEach((rootId) => {
    byRoot.get(rootId).forEach((info, otherRootId) => {
      const key = [rootId, otherRootId].sort().join('|');
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      const reciprocal = byRoot.get(otherRootId)?.get(rootId) ?? null;
      bridges.push({
        a: rootId,
        b: otherRootId,
        branchA: info.branchId,
        branchB: reciprocal?.branchId ?? null,
        pathA: info.path,
        pathB: reciprocal?.path ?? null,
        weight: Math.min(countDescendants(persons, rootId), countDescendants(persons, otherRootId)),
        // From root a's side, the bridging person is `cur` (aGender) married to
        // `spouse` on root b's side (bGender) — see findRootBridges above.
        aGender: info.selfGender,
        bGender: info.spouseGender,
      });
    });
  });
  return bridges;
}

// Orders forest roots so bridged families sit adjacent wherever a 1-D left-to-right
// layout allows — each root can have at most two neighbours, so a root linked to
// three or more others can only be made adjacent to its two strongest links; the
// rest fall back to the leftover pass (still rendered, just not guaranteed adjacent).
// Only builds one chain (around the single strongest bridge and whatever attaches
// to its ends) — a root family with two entirely separate bridge clusters wouldn't
// get both chained; not a concern for the datasets this was built against.
export function orderRootsForBridges(roots, bridges) {
  if (!bridges.length) return [...roots];
  const sorted = [...bridges].sort((a, b) => b.weight - a.weight);
  let chain = null;
  const placed = new Set();

  sorted.forEach((bridge) => {
    const { a, b } = bridge;
    if (!chain) {
      if (!placed.has(a) && !placed.has(b)) {
        // Husband's/father's side left, wife's/mother's side right, whenever the
        // bridging couple's genders are known and differ — kept stable regardless
        // of which side was created first (e.g. adding a sibling to one spouse
        // before the other shouldn't flip which family ends up on which edge).
        chain = bridge.aGender === 'female' && bridge.bGender === 'male' ? [b, a] : [a, b];
        placed.add(a);
        placed.add(b);
      }
      return;
    }
    const aIn = placed.has(a);
    const bIn = placed.has(b);
    if (aIn === bIn) return; // both already placed, or both still new — can't extend from here
    const inChain = aIn ? a : b;
    const newRoot = aIn ? b : a;
    if (inChain === chain[0]) {
      chain.unshift(newRoot);
      placed.add(newRoot);
    } else if (inChain === chain[chain.length - 1]) {
      chain.push(newRoot);
      placed.add(newRoot);
    }
    // else: inChain is in the middle of the chain (both its slots are taken) —
    // this bridge can't get adjacency; newRoot falls through to the leftover pass.
  });

  const leftovers = roots.filter((r) => !placed.has(r));
  return chain ? [...chain, ...leftovers] : leftovers;
}

// For each root, if one of its *actual* final neighbours (per orderRootsForBridges)
// has a bridge to it, moves that bridge's branch to the edge facing that neighbour —
// e.g. Subramanian's Kesavamoorthy branch moves to his rightmost slot when Kasi ends
// up immediately to his right. The bridging descendant isn't always the root's own
// direct child, though — if an ancestor gets added above the root (e.g. Subramanian's
// own father), the root's one and only child is that ancestor's link to Subramanian,
// while the actual siblings that need to move aside (Kesavamoorthy vs. his siblings)
// are a level further down, under Subramanian, who by then isn't a root at all and
// would otherwise never get reordered. `bridge.pathA`/`pathB` carry the FULL chain
// from the root down to the actual bridging person, so this walks every step of that
// chain and reorders EVERY level with more than one child, all toward the same edge —
// each hop cascades the branch one generation further in the same direction, landing
// the actual bridging descendant (and everyone under them) at the outermost edge of
// the whole subtree, exactly as if they were still their own top-level root's child.
// Returns a Map of personId -> reordered childrenIds (only for people who need
// reordering, at any depth — not just orderedRoots); callers with no entry for a given
// person just use that person's natural childrenIds order.
export function computeChildOrderOverrides(persons, orderedRoots, bridges) {
  const bridgeByPair = new Map(bridges.map((br) => [[br.a, br.b].sort().join('|'), br]));
  const overrides = new Map();
  // personId -> [{ childId, direction, weight }] — collected across every root/path
  // before reordering, so a person reachable from two different bridge paths picks
  // the heavier one, same tie-break as before.
  const movesByPerson = new Map();

  orderedRoots.forEach((rootId, idx) => {
    const neighbors = [
      [orderedRoots[idx - 1], 'left'],
      [orderedRoots[idx + 1], 'right'],
    ];
    neighbors.forEach(([neighborId, direction]) => {
      if (!neighborId) return;
      const bridge = bridgeByPair.get([rootId, neighborId].sort().join('|'));
      if (!bridge) return;
      const path = bridge.a === rootId ? bridge.pathA : bridge.pathB;
      if (!path || !path.length) return;
      // path = [rootId's direct child, ..., the actual bridging person]. Walk every
      // consecutive (parentId, childId) pair, including root -> path[0].
      const fullChain = [rootId, ...path];
      for (let i = 0; i < fullChain.length - 1; i += 1) {
        const parentId = fullChain[i];
        const childId = fullChain[i + 1];
        if (!movesByPerson.has(parentId)) movesByPerson.set(parentId, []);
        movesByPerson.get(parentId).push({ childId, direction, weight: bridge.weight });
      }
    });
  });

  movesByPerson.forEach((moves, personId) => {
    const person = persons[personId];
    if (!person) return;
    const byChild = new Map();
    moves.forEach((m) => {
      if (!person.childrenIds.includes(m.childId)) return;
      const existing = byChild.get(m.childId);
      if (!existing || m.weight > existing.weight) byChild.set(m.childId, m);
    });
    if (!byChild.size) return;

    let order = person.childrenIds.filter((c) => persons[c]);
    byChild.forEach((m) => {
      order = order.filter((c) => c !== m.childId);
      order = m.direction === 'left' ? [m.childId, ...order] : [...order, m.childId];
    });
    overrides.set(personId, order);
  });

  return overrides;
}

export function getFullName(person) {
  if (!person) return '';
  return `${person.firstName} ${person.lastName}`.trim();
}

// Re-derives the same surname convention App.jsx's childSurnameFor/
// spouseDefaultFor apply ONCE at creation time — a child's surname is their
// father's first name; a wife marrying in takes her husband's first name; a
// husband marrying in keeps his own (unknown here, so nothing to suggest).
// Needed because lastName is a plain stored field, never recomputed after
// creation — if a father is added to someone RETROACTIVELY (after they or
// their own children already exist), nothing goes back and updates those
// surnames on its own. Returns '' when nothing can be inferred; callers
// (see the "fill missing surnames" admin action) are responsible for only
// applying this where the person's CURRENT last name is blank — this
// function itself doesn't know or care whether one is already set.
export function suggestLastName(persons, personId) {
  const person = getPerson(persons, personId);
  if (!person) return '';

  if (person.parentIds.length > 0) {
    for (const parentId of person.parentIds) {
      if (getPerson(persons, parentId)?.gender === 'male') return getPerson(persons, parentId).firstName;
    }
    for (const parentId of person.parentIds) {
      const parentSpouse = getPerson(persons, getPerson(persons, parentId)?.spouseId);
      if (parentSpouse?.gender === 'male') return parentSpouse.firstName;
    }
    return '';
  }

  const spouse = getPerson(persons, person.spouseId);
  if (spouse && person.gender === 'female' && spouse.gender === 'male') return spouse.firstName;
  return '';
}

// Unlike suggestLastName (which favors a person's OWN father — correct for a blank
// name, but not what's wanted for someone already married), this is for the "update
// married women's surnames" admin action: a wife's last name should be her CURRENT
// husband's first name, even though she still has her father recorded as a parent.
// Only returns non-'' for the one case the naming convention actually redefines a
// surname at marriage (a woman marrying a man) — a husband marrying in keeps his own
// name, so there's nothing to suggest for him.
export function suggestMarriedSurname(persons, personId) {
  const person = getPerson(persons, personId);
  if (!person || person.gender !== 'female') return '';
  const spouse = getPerson(persons, person.spouseId);
  if (!spouse || spouse.gender !== 'male') return '';
  return spouse.firstName || '';
}

// Full name with the person's pet name appended in brackets, e.g. "Satish Kumar
// Chandrasekaran (Sambu)" — used wherever a person's name is shown as their own
// primary label (the detail panel header), not in tight spaces like tree cards or
// inline confirm-dialog text where the extra text would just add clutter.
export function getDisplayName(person) {
  const name = getFullName(person);
  return person?.petName?.trim() ? `${name} (${person.petName.trim()})` : name;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formats an ISO date for display as "14-Jun-1991" — the underlying <input type="date">
// value stays ISO (browsers require that), this is purely presentational. Falls back to
// showing the raw value as-is for anything that isn't a full YYYY-MM-DD (e.g. a
// year-only "1995", which the app allows when the exact date isn't known).
export function formatDateDisplay(iso) {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  const monthAbbr = MONTH_ABBR[Number(month) - 1];
  if (!monthAbbr) return iso;
  return `${day}-${monthAbbr}-${year}`;
}

export function getInitials(person) {
  if (!person) return '?';
  const first = person.firstName?.[0] || '';
  const last = person.lastName?.[0] || '';
  return (first + last).toUpperCase() || '?';
}

// Returns whole years between two ISO dates (or date -> now).
function yearsBetween(fromIso, toIso) {
  const from = new Date(fromIso);
  const to = toIso ? new Date(toIso) : new Date();
  if (isNaN(from) || isNaN(to)) return null;
  let age = to.getFullYear() - from.getFullYear();
  const m = to.getMonth() - from.getMonth();
  if (m < 0 || (m === 0 && to.getDate() < from.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

// { value: number, label: "Age" | "Lived" } or null when DOB missing.
export function getAgeInfo(person) {
  if (!person || !person.dob) return null;
  if (!person.isAlive && person.dod) {
    const years = yearsBetween(person.dob, person.dod);
    return years == null ? null : { value: years, label: 'Lived' };
  }
  const years = yearsBetween(person.dob, null);
  return years == null ? null : { value: years, label: 'Age' };
}

// Days until the next occurrence of dob's month/day (0 = today), or null if missing/invalid.
export function getDaysUntilBirthday(dob, today = new Date()) {
  if (!dob) return null;
  const date = new Date(dob);
  if (isNaN(date)) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(start.getFullYear(), date.getMonth(), date.getDate());
  if (next < start) next = new Date(start.getFullYear() + 1, date.getMonth(), date.getDate());
  return Math.round((next - start) / 86400000);
}

// "March 15" — month/day only, no year (used when ages are hidden for privacy).
export function formatBirthdayNoYear(dob) {
  if (!dob) return null;
  const date = new Date(dob);
  if (isNaN(date)) return null;
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

// Direct children count plus one layer down (children's children) — a quick
// "family size" indicator for the detail panel.
export function getFamilyStats(persons, person) {
  if (!person) return null;
  const children = getChildren(persons, person);
  const grandchildrenCount = children.reduce((sum, child) => sum + child.childrenIds.length, 0);
  return {
    childrenCount: children.length,
    grandchildrenCount,
    siblingsCount: getSiblings(persons, person).length,
  };
}

// id -> generations-up distance map (0 = self), walking every recorded parent
// (not just parentIds[0]) so both blood-lines are covered.
function ancestorDistances(persons, id) {
  const dist = new Map([[id, 0]]);
  let frontier = [id];
  let depth = 0;
  while (frontier.length) {
    depth += 1;
    const next = [];
    for (const curId of frontier) {
      const cur = getPerson(persons, curId);
      if (!cur) continue;
      for (const parentId of cur.parentIds) {
        if (!dist.has(parentId)) {
          dist.set(parentId, depth);
          next.push(parentId);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

const GREAT_PREFIXES = ['', 'Great-', 'Great-Great-'];
// Every call site passes `n` as (distance - 2) and interpolates the result
// into a template that already has ONE "Great-"/"Grand-" baked in (e.g.
// `${prefix}Great-Grandfather`, `${prefix}Grand-Uncle`) — so n=1 (the
// nearest case those templates handle, e.g. a great-grandparent) needs an
// EMPTY prefix, not 'Great-', or it doubles up into "Great-Great-Grandfather"
// for a plain great-grandparent. Shifting by 1 here (rather than fixing every
// call site) keeps all of them correct in one place.
function greatPrefix(n) {
  const extra = n - 1;
  if (extra <= 0) return '';
  if (extra < GREAT_PREFIXES.length) return GREAT_PREFIXES[extra];
  return `${extra}x-Great-`;
}

function ordinal(n) {
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
  return `${n}th`;
}

// Nearest common ancestor between two people (via parentIds BFS). Returns the step
// distances { distA, distB } from each up to that ancestor, or null if unrelated.
function commonAncestor(persons, aId, bId) {
  const aAncestors = ancestorDistances(persons, aId);
  const bAncestors = ancestorDistances(persons, bId);
  let best = null;
  for (const [ancestorId, distA] of aAncestors) {
    const distB = bAncestors.get(ancestorId);
    if (distB == null) continue;
    if (!best || distA + distB < best.distA + best.distB) best = { distA, distB, ancestorId };
  }
  return best;
}

// Blood label from the person's and root's distances to their common ancestor.
function bloodLabelFromDistances(distPerson, distRoot, male, female) {
  // root is the common ancestor: person descends from root.
  if (distRoot === 0) {
    if (distPerson === 1) return male ? 'Son' : female ? 'Daughter' : 'Child';
    if (distPerson === 2) return male ? 'Grandson' : female ? 'Granddaughter' : 'Grandchild';
    const prefix = greatPrefix(distPerson - 2);
    return male ? `${prefix}Great-Grandson` : female ? `${prefix}Great-Granddaughter` : `${prefix}Great-Grandchild`;
  }
  // person is the common ancestor: root descends from person.
  if (distPerson === 0) {
    if (distRoot === 1) return male ? 'Father' : female ? 'Mother' : 'Parent';
    if (distRoot === 2) return male ? 'Grandfather' : female ? 'Grandmother' : 'Grandparent';
    const prefix = greatPrefix(distRoot - 2);
    return male ? `${prefix}Great-Grandfather` : female ? `${prefix}Great-Grandmother` : `${prefix}Great-Grandparent`;
  }
  // Same generation from the shared ancestor: siblings or cousins.
  if (distRoot === distPerson) {
    if (distRoot === 1) return male ? 'Brother' : female ? 'Sister' : 'Sibling';
    return `${ordinal(distRoot - 1)} Cousin`;
  }
  // Different generations, neither is the other's direct ancestor. (No "removed"
  // suffix — cousins across generations are just labelled by the lower cousin degree.)
  if (distRoot < distPerson) {
    if (distRoot === 1 && distPerson === 2) return male ? 'Nephew' : female ? 'Niece' : 'Nibling';
    if (distRoot === 1) {
      const prefix = greatPrefix(distPerson - 2);
      return male ? `${prefix}Grand-Nephew` : female ? `${prefix}Grand-Niece` : `${prefix}Grand-Nibling`;
    }
    return `${ordinal(distRoot - 1)} Cousin`;
  }
  if (distPerson === 1 && distRoot === 2) return male ? 'Uncle' : female ? 'Aunt' : 'Aunt/Uncle';
  if (distPerson === 1) {
    const prefix = greatPrefix(distRoot - 2);
    return male ? `${prefix}Grand-Uncle` : female ? `${prefix}Grand-Aunt` : `${prefix}Grand-Aunt/Uncle`;
  }
  return `${ordinal(distPerson - 1)} Cousin`;
}

function bloodLabel(persons, personId, rootId, male, female) {
  const best = commonAncestor(persons, personId, rootId);
  if (!best) return null;
  return bloodLabelFromDistances(best.distA, best.distB, male, female);
}

// person married INTO root's blood family: person's spouse is `dist`-related to root.
// distSP/distRoot are the spouse's and root's distances to their common ancestor.
function inLawTermMarriedIn(distSP, distRoot, male, female) {
  // person's own spouse IS a direct ancestor of root (e.g. a grandfather's
  // wife who isn't recorded as a blood parent herself) — was previously
  // unhandled entirely, leaving the relationship badge blank.
  if (distSP === 0) {
    if (distRoot === 1) return male ? 'Father' : female ? 'Mother' : 'Parent';
    if (distRoot === 2) return male ? 'Grandfather' : female ? 'Grandmother' : 'Grandparent';
    const prefix = greatPrefix(distRoot - 2);
    return male ? `${prefix}Great-Grandfather` : female ? `${prefix}Great-Grandmother` : `${prefix}Great-Grandparent`;
  }
  if (distRoot === 0) {
    if (distSP === 1) return male ? 'Son-in-law' : female ? 'Daughter-in-law' : 'Child-in-law';
    if (distSP === 2) return male ? 'Grandson-in-law' : female ? 'Granddaughter-in-law' : 'Grandchild-in-law';
    const prefix = greatPrefix(distSP - 2);
    return male ? `${prefix}Great-Grandson-in-law` : female ? `${prefix}Great-Granddaughter-in-law` : `${prefix}Great-Grandchild-in-law`;
  }
  if (distRoot === 1 && distSP === 1) return male ? 'Brother-in-law' : female ? 'Sister-in-law' : 'Sibling-in-law';
  if (distSP === 1 && distRoot === 2) return male ? 'Uncle-in-law' : female ? 'Aunt-in-law' : 'Aunt/Uncle-in-law';
  if (distSP === 1 && distRoot > 2) {
    const prefix = greatPrefix(distRoot - 2);
    return male ? `${prefix}Grand-Uncle-in-law` : female ? `${prefix}Grand-Aunt-in-law` : `${prefix}Grand-Aunt/Uncle-in-law`;
  }
  // A cousin's own spouse (any degree), or the spouse of a grand-uncle/aunt's
  // child playing that same cousin role one generation further removed (see
  // tamilRemovedUncleAuntPairTerm) — both were previously unhandled, which
  // left the relationship badge blank even once a Tamil term for the same
  // relation (Anni/Mama/Chithi/Periyamma/...) existed, since PersonDetail
  // only shows the badge at all when this English label resolves.
  if (distSP >= 2 && (distSP === distRoot || distSP === distRoot - 1)) {
    const label = `${ordinal(Math.min(distSP, distRoot) - 1)} Cousin`;
    return male ? `${label}'s Husband` : female ? `${label}'s Wife` : `${label}'s Spouse`;
  }
  return null;
}

// person is blood kin of root's spouse (RS): person is `dist`-related to RS.
function inLawTermSpouseKin(distPerson, distRS, male, female) {
  if (distPerson === 0) {
    if (distRS === 1) return male ? 'Father-in-law' : female ? 'Mother-in-law' : 'Parent-in-law';
    if (distRS === 2) return male ? 'Grandfather-in-law' : female ? 'Grandmother-in-law' : 'Grandparent-in-law';
    const prefix = greatPrefix(distRS - 2);
    return male ? `${prefix}Great-Grandfather-in-law` : female ? `${prefix}Great-Grandmother-in-law` : `${prefix}Great-Grandparent-in-law`;
  }
  if (distPerson === 1 && distRS === 1) return male ? 'Brother-in-law' : female ? 'Sister-in-law' : 'Sibling-in-law';
  if (distPerson === 1 && distRS === 2) return male ? 'Uncle-in-law' : female ? 'Aunt-in-law' : 'Aunt/Uncle-in-law';
  if (distPerson === 1 && distRS > 2) {
    const prefix = greatPrefix(distRS - 2);
    return male ? `${prefix}Grand-Uncle-in-law` : female ? `${prefix}Grand-Aunt-in-law` : `${prefix}Grand-Aunt/Uncle-in-law`;
  }
  // root's spouse's sibling's own child (e.g. your wife's sister's child).
  if (distPerson === 2 && distRS === 1) return male ? 'Nephew-in-law' : female ? 'Niece-in-law' : 'Nephew/Niece-in-law';
  // root's spouse's uncle/aunt's own child (e.g. Kesavamoorthy's child,
  // relative to Soundari) — root's spouse's 1st cousin.
  if (distPerson === 2 && distRS === 2) return 'Cousin-in-law';
  // root's spouse's 1st cousin's own child (e.g. Iniya, whose mother Sowmiya
  // is root's spouse's 1st cousin) — one generation further removed, same
  // plain-ordinal pattern bloodLabelFromDistances' own cousin fallback uses.
  if (distPerson === 3 && distRS === 2) return `${ordinal(distPerson - 1)} Cousin-in-law`;
  return null;
}

// Marriage-based (in-law) relationship of person to root, one marriage hop from a blood
// tie in either direction. Returns the closest match, or null if none in scope.
function inLawLabel(persons, personId, rootId, male, female) {
  const person = getPerson(persons, personId);
  const root = getPerson(persons, rootId);
  if (!person || !root) return null;
  const candidates = [];

  // Only for a genuine step-relation (personId has no recorded blood link of
  // their own — e.g. a grandfather's second wife's own husband, who married
  // in without being anyone's recorded blood parent themselves) — skipped
  // when personId is ALSO independently blood-related to rootId, or an
  // ordinary two-parent couple would double up: person.spouse being the
  // OTHER, blood-recorded parent (matched here) duplicates the "Father"/
  // "Mother" that bloodLabel already derives directly from personId's own
  // parentIds, producing a nonsensical "Father / Father" instead of just
  // "Father".
  if (person.spouseId && person.spouseId !== rootId && !commonAncestor(persons, personId, rootId)) {
    const ca = commonAncestor(persons, person.spouseId, rootId);
    if (ca) {
      const term = inLawTermMarriedIn(ca.distA, ca.distB, male, female);
      if (term) candidates.push({ term, cost: ca.distA + ca.distB });
    }
  }
  if (root.spouseId && root.spouseId !== personId) {
    const ca = commonAncestor(persons, personId, root.spouseId);
    if (ca) {
      const term = inLawTermSpouseKin(ca.distA, ca.distB, male, female);
      if (term) candidates.push({ term, cost: ca.distA + ca.distB });
    }
  }
  // person's own spouse is a sibling of root's own spouse (e.g. person married
  // root's wife's sister) — English equivalent of the Annan/co-sibling-in-law
  // Tamil terms below; without this, PersonDetail hides the relationship
  // badge entirely (Tamil included) since it only shows once this resolves.
  if (root.spouseId && person.spouseId && person.spouseId !== rootId && person.spouseId !== root.spouseId) {
    const ca3 = commonAncestor(persons, person.spouseId, root.spouseId);
    if (ca3 && ca3.distA === 1 && ca3.distB === 1) {
      candidates.push({ term: male ? 'Brother-in-law' : female ? 'Sister-in-law' : 'Sibling-in-law', cost: 3 });
    }
    // person's own spouse is uncle/aunt-level blood-related to root's own
    // spouse (e.g. Vanaja, married to Soundari's husband's mother's brother).
    if (ca3 && ca3.distA === 1 && ca3.distB === 2) {
      candidates.push({ term: male ? 'Uncle-in-law' : female ? 'Aunt-in-law' : 'Aunt/Uncle-in-law', cost: 4 });
    }
  }
  if (tamilIsSambandhi(persons, personId, rootId) || tamilIsSambandhi(persons, rootId, personId)) {
    candidates.push({ term: 'Co-parent-in-law', cost: 4 });
  }
  if (root.spouseId && person.spouseId && root.spouseId !== personId && person.spouseId !== rootId) {
    const ca4 = commonAncestor(persons, root.spouseId, person.spouseId);
    if (ca4 && ca4.distA === 1 && ca4.distB === 1) {
      if (male && root.gender === 'male') candidates.push({ term: 'Co-brother-in-law', cost: 4 });
      if (female && root.gender === 'female') candidates.push({ term: 'Co-sister-in-law', cost: 4 });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0].term;
}

// Plain-language relationship of `personId` to `rootId` — blood (e.g. "Grandson",
// "Aunt", "2nd Cousin"), marriage/in-law (e.g. "Sister-in-law"), or both joined with
// " / " when a person is related in more than one way. Returns null for the root
// themselves, an unrelated/unrecorded pair, or when either id is missing.
// Split out for the same reason computePrimaryTamilTerm is — the generic
// spousal fallback below needs to call this WITHOUT re-triggering itself.
function computePrimaryEnglishTerm(persons, personId, rootId) {
  if (!personId || !rootId || personId === rootId) return null;
  const person = getPerson(persons, personId);
  const root = getPerson(persons, rootId);
  if (!person || !root) return null;

  if (person.spouseId === rootId) return 'Spouse';

  const male = person.gender === 'male';
  const female = person.gender === 'female';

  const parts = [
    bloodLabel(persons, personId, rootId, male, female),
    inLawLabel(persons, personId, rootId, male, female),
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : null;
}

// Only the plain, direct-style sibling/uncle words a REAL "X-in-law" relation
// would use — deliberately NOT a generic "<anything>'s Spouse (in-law)"
// construction (reads as a manufactured, nested description rather than a
// real relationship name). Anyone whose spouse's own term isn't one of these
// four plain words (e.g. an already-compound "Cousin-in-law") gets no
// English label at all rather than a fabricated one — PersonDetail shows the
// Tamil term alone in that case.
const ENGLISH_SPOUSE_MIRROR = {
  Brother: 'Sister-in-law',
  Sister: 'Brother-in-law',
  Uncle: 'Aunt-in-law',
  Aunt: 'Uncle-in-law',
};

// Same-role gender counterpart for the sibling-inheritance fallback below —
// e.g. Brother/Sister are the same role, differing only by whose own gender
// it's describing. Deliberately covers ONLY these four plain words, same
// restriction ENGLISH_SPOUSE_MIRROR applies above: a compound phrase like
// "1st Cousin's Wife" describes a specific marriage, not a category, so
// copying it onto a DIFFERENT person (personId's own sibling) fabricates a
// claim about them rather than describing their real relationship — English
// has no word for "cousin-in-law's sibling", so that case now returns null
// (the Tamil term still shows on its own) instead of a wrong phrase.
const ENGLISH_SIBLING_GENDER_PAIRS = {
  Brother: { male: 'Brother', female: 'Sister' },
  Sister: { male: 'Brother', female: 'Sister' },
  Uncle: { male: 'Uncle', female: 'Aunt' },
  Aunt: { male: 'Uncle', female: 'Aunt' },
};

// English counterpart to resolveTamilTermChained — same reasoning: each
// fallback recurses into the others (via cycle-protected `visiting`) so a
// chain of any length resolves correctly, not just one hop of composability.
function resolveEnglishTermChained(persons, personId, rootId, visiting) {
  // See resolveTamilTermChained's matching guard — the fallback layers below
  // (sibling-inheritance especially) don't independently know that personId
  // === rootId means "no real relationship to compute", so without this a
  // sibling's own valid term gets misattributed as your relationship to
  // yourself when viewing your own profile.
  if (personId === rootId) return null;
  if (visiting.has(personId)) return null;
  visiting.add(personId);
  try {
    const primary = computePrimaryEnglishTerm(persons, personId, rootId);
    if (primary) return primary;

    const person = getPerson(persons, personId);
    if (!person) return null;

    if (person.spouseId && person.spouseId !== rootId) {
      const spouseTerm = resolveEnglishTermChained(persons, person.spouseId, rootId, visiting);
      const mapped = spouseTerm && ENGLISH_SPOUSE_MIRROR[spouseTerm];
      if (mapped) return mapped;
    }

    // Sibling inheritance — re-picks the inherited relation's gender-correct
    // word for personId's OWN gender (see ENGLISH_SIBLING_GENDER_PAIRS),
    // rather than copying a sibling's own clean term as-is regardless of
    // whether it's still gender-correct for the person inheriting it.
    for (const sibling of getSiblings(persons, person)) {
      const siblingTerm = resolveEnglishTermChained(persons, sibling.id, rootId, visiting);
      const pair = siblingTerm && ENGLISH_SIBLING_GENDER_PAIRS[siblingTerm];
      if (pair) return person.gender === 'male' ? pair.male : person.gender === 'female' ? pair.female : siblingTerm;
    }

    // Parent-category inheritance — a plain, direct-style word for each
    // category rather than a nested description. A parent who is themselves
    // only a chained "Cousin-in-law" (no blood path, e.g. Vinoth) still
    // makes their own child a "Cousin-in-law" too — there's no side/removal
    // data left at this depth to say anything more specific.
    for (const parentId of person.parentIds || []) {
      const parentTerm = resolveEnglishTermChained(persons, parentId, rootId, visiting);
      if (parentTerm === 'Uncle-in-law' || parentTerm === 'Aunt-in-law' || parentTerm === 'Cousin-in-law') {
        return 'Cousin-in-law';
      }
    }
    return null;
  } finally {
    visiting.delete(personId);
  }
}

export function getRelationshipLabel(persons, personId, rootId) {
  return resolveEnglishTermChained(persons, personId, rootId, new Set());
}

// --- Tamil relationship terms ----------------------------------------------
// Tamil kinship terms are more granular than the English labels above: they
// distinguish paternal from maternal relatives (Mama = mother's brother vs.
// Chithappa = father's younger brother) and elder from younger (Anna vs. Thambi)
// — neither of which English marks at all, so those have to be worked out
// separately here rather than just translating the English word. Where that
// isn't possible (birth order can't be determined) or a specific family/regional
// convention would matter (cousins beyond 1st, several in-law directions), this
// falls back to a plain descriptive phrase instead of guessing a specific term —
// those are the spots most worth double-checking against your own family's usage.

// 'elder' | 'younger' | null — from idA/idB's position in `ancestorId`'s own
// childrenIds (both are always children of ancestorId at the call sites below —
// a sibling pair, or an uncle/aunt alongside the parent connecting them to root),
// NOT from DOB: DOB is frequently missing or, worse, an accidental placeholder
// value (e.g. the date the record was created) rather than a real birthdate,
// which reads as confidently wrong instead of just absent. childrenIds order is
// exactly what useFamily's reorderChild (the up/down arrows on the Children
// list) lets you set directly, so it's the more trustworthy signal to use.
function tamilBirthOrder(persons, ancestorId, idA, idB) {
  const ancestor = getPerson(persons, ancestorId);
  if (!ancestor) return null;
  const idxA = ancestor.childrenIds.indexOf(idA);
  const idxB = ancestor.childrenIds.indexOf(idB);
  if (idxA === -1 || idxB === -1 || idxA === idxB) return null;
  return idxA < idxB ? 'elder' : 'younger';
}

// Whether `ancestorId` is reached from `referenceId` via their father or mother —
// needed because Tamil uncle/aunt terms depend on which side of the family
// they're on, something English "uncle"/"aunt" doesn't track at all. Takes a
// generic `referenceId` (not always rootId) because the same check is also
// needed relative to root's SPOUSE (addressing your spouse's uncle/aunt).
function tamilSideFromRoot(persons, referenceId, ancestorId) {
  const reference = getPerson(persons, referenceId);
  if (!reference) return null;
  const [fatherId, motherId] = reference.parentIds;
  const viaFather = fatherId ? ancestorDistances(persons, fatherId).has(ancestorId) : false;
  const viaMother = motherId ? ancestorDistances(persons, motherId).has(ancestorId) : false;
  if (viaFather && !viaMother) return 'paternal';
  if (viaMother && !viaFather) return 'maternal';
  return null;
}

// The direct child of `ancestorId` lying on the path down to `descendantId`
// (which is `totalDist` steps below the ancestor) — e.g. for a nephew this finds
// root's own sibling (the nephew's parent, whose gender picks the right term);
// for an uncle, this finds root's own parent (the uncle's sibling), so it can be
// checked for birth order against them; for a 1st cousin, this finds each side's
// own connecting parent, to tell a cross-cousin from a parallel one.
function tamilConnectingChild(persons, ancestorId, descendantId, totalDist) {
  const ancestor = getPerson(persons, ancestorId);
  if (!ancestor || totalDist < 1) return null;
  const distances = ancestorDistances(persons, descendantId);
  return ancestor.childrenIds.find((cid) => distances.get(cid) === totalDist - 1) || null;
}

// Periyappa/Periyamma (elder-uncle pair), Chithappa/Chithi (younger-uncle pair),
// or Mama/Athai (cross-sibling pair) — ONE pair covers both the blood relative
// and their in-law spouse: father's elder brother is Periyappa, and HIS WIFE is
// also Periyamma (not a separate "aunt-in-law" word); mother's brother is Mama,
// and HIS WIFE is Athai (the same word as father's own sister). Which pair
// applies is decided by `bloodRelativeId` (whoever is actually blood-related to
// `referenceId`); which half of that pair is returned is just personGender —
// so this works whether `personId`/`bloodRelativeId` are the same person (a
// direct blood uncle/aunt) or personId is married to bloodRelativeId (an in-law
// uncle/aunt by marriage).
// `refDistance` is how many generations below `ancestorId` referenceId sits
// (2 for a direct uncle/aunt, where ancestorId is referenceId's grandparent) —
// pass 3 to reuse this one generation further removed (a grand-uncle/aunt's
// child, "if older/younger than Father" — see tamilRemovedUncleAuntPairTerm),
// where the elder/younger check needs to land on referenceId's GRANDPARENT
// instead of their parent.
// `sideGenderOverride` lets the removed-uncle/aunt case (below) decide
// same-side/cross-side from the ACTUAL person being addressed rather than
// bloodRelativeId — a blood female one generation up is always Athai (never
// Periyamma/Chithi, which is reserved for a wife married IN to that role),
// matching how a direct father's-sister is Athai purely because SHE is
// female, regardless of her own brother's side.
// `useThaiMama` upgrades a maternal cross-uncle to 'தாய் மாமா' — but ONLY
// correct when `referenceId` is root's OWN family (side is being measured
// relative to root's own parentage, so this really is root's own mother's
// brother). The exact same function, with `referenceId = root.spouseId`,
// also computes root's SPOUSE's uncle (e.g. a mother-in-law's brother) —
// those call sites leave this false and never get the "MY mother's brother"
// wording.
// `invertSide` — for THOSE same root.spouseId call sites, the paternal/
// maternal classification itself flips relative to what the spouse's OWN
// blood family would use: a spouse's mother's BROTHER (cross to the spouse,
// e.g. Kesavamoorthy to Velmurugan = Mama) is addressed by the person who
// MARRIED IN as if paternal-side instead (Periyappa/Chithappa to Soundari);
// a spouse's mother's SISTER (same-side to the spouse, e.g. Amutha to
// Velmurugan = Chithi) flips the other way (Athai to Soundari). This mirrors
// the classificatory-kinship logic already used throughout this file for
// cross-cousin marriage (the family you marry into sits on the "opposite"
// side from your spouse's own perspective) — confirmed against both of the
// examples above, not a guess for just one of them.
function tamilUncleAuntPairTerm(persons, referenceId, ancestorId, bloodRelativeId, personGender, refDistance = 2, sideGenderOverride = null, useThaiMama = false, invertSide = false) {
  const bloodRelative = getPerson(persons, bloodRelativeId);
  if (!bloodRelative) return null;
  let side = tamilSideFromRoot(persons, referenceId, ancestorId);
  if (invertSide && side) side = side === 'paternal' ? 'maternal' : 'paternal';
  const connectingParent = tamilConnectingChild(persons, ancestorId, referenceId, refDistance);
  const order = connectingParent ? tamilBirthOrder(persons, ancestorId, bloodRelativeId, connectingParent) : null;
  const bloodGender = sideGenderOverride || bloodRelative.gender;

  const sameSide = (side === 'paternal' && bloodGender === 'male') || (side === 'maternal' && bloodGender === 'female');
  const crossSide = (side === 'paternal' && bloodGender === 'female') || (side === 'maternal' && bloodGender === 'male');

  if (crossSide) {
    const thaiMama = useThaiMama && side === 'maternal';
    if (personGender === 'male') return thaiMama ? 'தாய் மாமா' : 'மாமா';
    if (personGender === 'female') return 'அத்தை';
    return thaiMama ? 'தாய் மாமா/அத்தை' : 'மாமா/அத்தை';
  }
  if (sameSide) {
    if (order === 'elder') return personGender === 'male' ? 'பெரியப்பா' : personGender === 'female' ? 'பெரியம்மா' : 'பெரியப்பா/பெரியம்மா';
    if (order === 'younger') return personGender === 'male' ? 'சித்தப்பா' : personGender === 'female' ? 'சித்தி/சின்னம்மா' : 'சித்தப்பா/சித்தி';
    return personGender === 'male' ? 'பெரியப்பா/சித்தப்பா' : personGender === 'female' ? 'பெரியம்மா/சித்தி' : null;
  }
  // Side couldn't be determined at all (e.g. root has no recorded parents).
  return personGender === 'male' ? 'பெரியப்பா/சித்தப்பா/மாமா' : personGender === 'female' ? 'பெரியம்மா/சித்தி/அத்தை' : null;
}

// Grand-uncle/aunt's child (English "1st cousin once removed") — Tamil treats
// them with the SAME Periyappa/Chithappa/Periyamma/Chithi/Mama/Athai words as a
// direct uncle/aunt, one generation further removed. `personId` is always the
// actual blood descendant of the grand-uncle/aunt (either the person we want
// the word FOR directly, or — when called for their spouse — whoever plays
// that blood role, e.g. a "removed Chithappa"'s own wife); their OWN gender
// decides which pair applies (a blood female up here is always Athai, never
// Periyamma/Chithi — see tamilUncleAuntPairTerm's sideGenderOverride),
// `personGender` just picks which half of it to return. The elder/younger
// split still compares personId's PARENT — the actual grand-uncle/aunt
// (`connectingSibling`) — against root's own GRANDPARENT (their real recorded
// sibling, sharing `ancestorId`), since personId themselves can't be directly
// compared against a generation they don't belong to; colloquially this is
// "older/younger than your father", the nearest pair the data can compare.
function tamilRemovedUncleAuntPairTerm(persons, rootId, ancestorId, personId, personGender) {
  const connectingSibling = tamilConnectingChild(persons, ancestorId, personId, 2);
  if (!connectingSibling) return null;
  const targetGender = getPerson(persons, personId)?.gender ?? null;
  // Both of this function's own call sites always pass rootId itself as the
  // reference (never root.spouseId) — this removed uncle/aunt is always on
  // ROOT'S OWN side, so the Thai-Mama upgrade is always safe here.
  return tamilUncleAuntPairTerm(persons, rootId, ancestorId, connectingSibling, personGender, 3, targetGender, true);
}

function tamilBloodLabelFromDistances(persons, personId, rootId, distPerson, distRoot, male, female, ancestorId) {
  // root is the common ancestor: person descends from root.
  if (distRoot === 0) {
    if (distPerson === 1) return male ? 'மகன்' : female ? 'மகள்' : 'குழந்தை';
    if (distPerson === 2) return male ? 'பேரன்' : female ? 'பேத்தி' : 'பேரக்குழந்தை';
    if (distPerson === 3) return male ? 'கொள்ளுப்பேரன்' : female ? 'கொள்ளுப்பேத்தி' : 'கொள்ளுப்பேரக்குழந்தை';
    return `${distPerson - 2}x கொள்ளுப்பேரன்/பேத்தி`;
  }
  // person is the common ancestor: root descends from person.
  if (distPerson === 0) {
    if (distRoot === 1) return male ? 'அப்பா' : female ? 'அம்மா' : 'பெற்றோர்';
    if (distRoot === 2) return male ? 'தாத்தா' : female ? 'பாட்டி' : 'பாட்டன்/பாட்டி';
    if (distRoot === 3) return male ? 'கொள்ளுத்தாத்தா' : female ? 'கொள்ளுப்பாட்டி' : 'கொள்ளுத்தாத்தா/பாட்டி';
    return `${distRoot - 2}x கொள்ளுத்தாத்தா/பாட்டி`;
  }
  // Same generation from the shared ancestor: siblings or cousins.
  if (distRoot === distPerson) {
    if (distRoot === 1) {
      const order = tamilBirthOrder(persons, ancestorId, personId, rootId);
      if (male) return order === 'elder' ? 'அண்ணன்' : order === 'younger' ? 'தம்பி' : 'சகோதரன்';
      if (female) return order === 'elder' ? 'அக்கா' : order === 'younger' ? 'தங்கை' : 'சகோதரி';
      return 'உடன்பிறப்பு';
    }
    if (distRoot === 2) {
      // 1st cousins: through two siblings of OPPOSITE gender (a brother-sister
      // pair) is a cross-cousin — Machaan/Machinichi, traditionally marriage-
      // eligible; through two siblings of the SAME gender (two brothers, or two
      // sisters) is a parallel cousin — Tamil just treats them as a sibling
      // (Anna/Thambi/Akka/Thangai), using the connecting parents' own relative
      // order as a stand-in for which cousin branch counts as "elder".
      const rootParent = tamilConnectingChild(persons, ancestorId, rootId, 2);
      const personParent = tamilConnectingChild(persons, ancestorId, personId, 2);
      const rootParentGender = rootParent ? getPerson(persons, rootParent)?.gender : null;
      const personParentGender = personParent ? getPerson(persons, personParent)?.gender : null;
      if (rootParentGender && personParentGender) {
        if (rootParentGender !== personParentGender) {
          return male ? 'மைத்துனன்/மச்சான்' : female ? 'மைத்துனி/மச்சினிச்சி' : 'மச்சான்/மச்சினிச்சி';
        }
        const order = tamilBirthOrder(persons, ancestorId, personParent, rootParent);
        if (male) return order === 'elder' ? 'அண்ணன்' : order === 'younger' ? 'தம்பி' : 'சகோதரன்';
        if (female) return order === 'elder' ? 'அக்கா' : order === 'younger' ? 'தங்கை' : 'சகோதரி';
      }
    }
    // Cousins beyond 1st, or 1st cousins whose branch couldn't be pinned down —
    // Tamil doesn't cleanly number "2nd/3rd cousin" the way English does either.
    return male ? 'ஒன்று விட்ட சகோதரன்' : female ? 'ஒன்று விட்ட சகோதரி' : 'ஒன்று விட்ட உறவினர்';
  }
  // Different generations, neither is the other's direct ancestor.
  if (distRoot < distPerson) {
    // Nephew/niece: root's sibling's child. It's not just the connecting
    // sibling's gender that matters, but whether it MATCHES root's own gender —
    // your own-gender sibling's kids are basically your own (Magan/Magal); it's
    // specifically your OPPOSITE-gender sibling's kids that become
    // Marumagan/Marumagal (the cross-cousin-marriage-eligible word, shared with
    // son/daughter-in-law).
    if (distRoot === 1 && distPerson === 2) {
      const connecting = tamilConnectingChild(persons, ancestorId, personId, distPerson);
      const connectingGender = connecting ? getPerson(persons, connecting)?.gender : null;
      const rootGender = getPerson(persons, rootId)?.gender;
      if (connectingGender && rootGender) {
        if (connectingGender !== rootGender) return male ? 'மருமகன்' : female ? 'மருமகள்' : 'மருமகன்/மருமகள்';
        return male ? 'மகன்' : female ? 'மகள்' : 'மகன்/மகள்';
      }
      return male ? 'சகோதரன்/சகோதரியின் மகன்' : female ? 'சகோதரன்/சகோதரியின் மகள்' : 'சகோதரன்/சகோதரியின் குழந்தை';
    }
    if (distRoot === 1) return male ? 'தொலைவு மருமகன்' : female ? 'தொலைவு மருமகள்' : 'தொலைவு மருமகன்/மருமகள்';
    if (distRoot === 2 && distPerson === 3) {
      // A 1st cousin's own child. Whether that's Magan/Magal (own-line) or
      // Marumagan/Marumagal (cross-line, marriage-eligible) depends on which
      // side the cousin is on — parallel (Father's Brother's / Mother's
      // Sister's child, already treated as a sibling — see the parallel-
      // cousin branch above) vs cross (Father's Sister's / Mother's Brother's
      // child — Machaan/Machinichi) — AND the cousin's OWN gender, NOT root's:
      // a parallel cousin's SON continues the line (Magan/Magal) but their
      // DAUGHTER marries out (Marumagan/Marumagal); a cross cousin's SON is
      // the marriage-eligible line (Marumagan/Marumagal) but their DAUGHTER's
      // child comes back to the line (Magan/Magal).
      const rootParent = tamilConnectingChild(persons, ancestorId, rootId, 2);
      const cousinParent = tamilConnectingChild(persons, ancestorId, personId, 3);
      const rootParentGender = rootParent ? getPerson(persons, rootParent)?.gender : null;
      const cousinParentGender = cousinParent ? getPerson(persons, cousinParent)?.gender : null;
      if (rootParentGender && cousinParentGender) {
        const isParallel = rootParentGender === cousinParentGender;
        const cousin = tamilConnectingChild(persons, cousinParent, personId, 2);
        const cousinGender = cousin ? getPerson(persons, cousin)?.gender : null;
        if (cousinGender) {
          const ownLine = isParallel ? cousinGender === 'male' : cousinGender === 'female';
          if (!ownLine) return male ? 'மருமகன்' : female ? 'மருமகள்' : 'மருமகன்/மருமகள்';
          return male ? 'மகன்' : female ? 'மகள்' : 'மகன்/மகள்';
        }
      }
    }
    return male ? 'ஒன்று விட்ட சகோதரன்' : female ? 'ஒன்று விட்ட சகோதரி' : 'ஒன்று விட்ட உறவினர்';
  }
  // distPerson < distRoot: person is root's parent's sibling (uncle/aunt) or further.
  if (distPerson === 1 && distRoot === 2) {
    // rootId itself is the reference here — root's own direct blood uncle/
    // aunt — so the Thai-Mama upgrade is safe (see tamilUncleAuntPairTerm).
    return tamilUncleAuntPairTerm(persons, rootId, ancestorId, personId, male ? 'male' : female ? 'female' : null, 2, null, true);
  }
  // Grand-uncle/aunt's child (1st cousin once removed) — same Periyappa/
  // Chithappa/Periyamma/Chithi/Mama/Athai pattern as a direct uncle/aunt.
  if (distPerson === 2 && distRoot === 3) {
    const term = tamilRemovedUncleAuntPairTerm(persons, rootId, ancestorId, personId, male ? 'male' : female ? 'female' : null);
    if (term) return term;
  }
  if (distPerson === 1) {
    return male ? 'பாட்டனாரின்/பாட்டியின் சகோதரர்' : female ? 'பாட்டனாரின்/பாட்டியின் சகோதரி' : 'பாட்டன்/பாட்டி வழி உறவினர்';
  }
  return male ? 'ஒன்று விட்ட சகோதரன்' : female ? 'ஒன்று விட்ட சகோதரி' : 'ஒன்று விட்ட உறவினர்';
}

// person's spouse is a direct child/grandchild of root — mappillai/marumagal
// (son/daughter-in-law) and further down. Unaffected by the uncle/aunt pair
// rework above (root IS the blood ancestor here, no side/cross logic applies).
function tamilInLawTermMarriedIn(distSP, distRoot, male, female) {
  if (distSP === 1) return male ? 'மருமகன்/மாப்பிள்ளை' : female ? 'மருமகள்/மணமகள்' : 'மாப்பிள்ளை/மருமகள்';
  if (distSP === 2) return male ? 'பேரன் மாப்பிள்ளை' : female ? 'பேத்தி மருமகள்' : 'பேரன்/பேத்தி வழி மணமகன்/மகள்';
  return male ? 'தொலைவு மாப்பிள்ளை' : female ? 'தொலைவு மருமகள்' : 'தொலைவு மணமகன்/மகள்';
}

// person's own spouse IS a direct ancestor of root (e.g. a grandfather's wife
// who isn't recorded as a blood parent herself — the exact gap that left
// Sundarambal's badge blank) — same அப்பா/அம்மா/தாத்தா/பாட்டி words a real
// blood ancestor at that generation would get.
function tamilAncestorSpouseTerm(distRoot, male, female) {
  if (distRoot === 1) return male ? 'அப்பா' : female ? 'அம்மா' : 'பெற்றோர்';
  if (distRoot === 2) return male ? 'தாத்தா' : female ? 'பாட்டி' : 'பாட்டன்/பாட்டி';
  if (distRoot === 3) return male ? 'கொள்ளுத்தாத்தா' : female ? 'கொள்ளுப்பாட்டி' : 'கொள்ளுத்தாத்தா/பாட்டி';
  return `${distRoot - 2}x கொள்ளுத்தாத்தா/பாட்டி`;
}

// Shared Anni/Marumagal/Mama/Maapillai term table for anyone treated as a
// sibling of root — a real direct sibling, or a parallel (same-side) 1st
// cousin, which Tamil also addresses with sibling terms (see the parallel-
// cousin branch of tamilBloodLabelFromDistances and its call site below) —
// so both get the SAME spouse term, keyed only on the sibling-like person's
// own gender and their elder/younger order relative to root: Anni (elder
// brother's wife) or Marumagal (younger brother's wife); Mama (elder sister's
// husband) or Maapillai (younger sister's husband).
function tamilSiblingSpouseTermFromOrder(siblingGender, order, personGender) {
  if (siblingGender === 'male' && personGender === 'female') {
    return order === 'elder' ? 'அண்ணி' : order === 'younger' ? 'மருமகள்' : 'சகோதரனின் மனைவி';
  }
  if (siblingGender === 'female' && personGender === 'male') {
    return order === 'elder' ? 'மாமா' : order === 'younger' ? 'மாப்பிள்ளை' : 'சகோதரியின் கணவர்';
  }
  return null;
}

// root's own sibling married `person` — see tamilSiblingSpouseTermFromOrder
// for the actual term table. Falls back to a plain descriptive phrase only
// when birth order can't be determined at all.
function tamilSiblingSpouseTerm(persons, ancestorId, rootId, siblingId, personGender) {
  const sibling = getPerson(persons, siblingId);
  if (!sibling) return null;
  const order = tamilBirthOrder(persons, ancestorId, siblingId, rootId);
  return tamilSiblingSpouseTermFromOrder(sibling.gender, order, personGender);
}

// Compares two people's DOB directly (elder/younger) — for the rare in-law
// relations where there's no shared ancestor/childrenIds to derive order from
// at all, e.g. a cross-cousin's own spouse: they're married in, not blood-
// related to root or anyone whose childrenIds could be checked. Returns null
// (rather than guessing) whenever either DOB is missing.
function tamilAgeOrder(persons, idA, idB) {
  const a = getPerson(persons, idA);
  const b = getPerson(persons, idB);
  if (!a?.dob || !b?.dob || a.dob === b.dob) return null;
  return a.dob < b.dob ? 'elder' : 'younger';
}

// A cross-cousin's (Machaan/Machinichi — see the cross-cousin branch of
// tamilBloodLabelFromDistances) own spouse — married in, so (unlike a
// parallel cousin) there's no shared-parent birth order to reuse; addressed
// with a plain sibling term instead — Akka/Thangai for a male cross-cousin's
// wife, Anna/Thambi for a female cross-cousin's husband — decided by comparing
// DOB directly against root. Shows both options when DOB is missing on either
// side rather than guessing.
// Requires BOTH cousinGender and the spouse's own personGender to agree with
// the expected opposite-gender pairing, mirroring tamilSiblingSpouseTermFromOrder
// just above — checking personGender directly (not just inferring "the spouse
// must be the opposite of the cousin") means a data-entry mistake on either
// person's Gender field surfaces as a missing term instead of a confidently
// wrong one (e.g. a male cross-cousin's spouse whose OWN gender is also
// recorded male — a real bug seen in production — now returns null here
// rather than showing தங்கை/Akka for someone who isn't actually female).
function tamilCrossCousinSpouseTerm(persons, personId, rootId, cousinGender, personGender) {
  const order = tamilAgeOrder(persons, personId, rootId);
  if (cousinGender === 'male' && personGender === 'female') {
    return order === 'elder' ? 'அக்கா' : order === 'younger' ? 'தங்கை' : 'அக்கா/தங்கை';
  }
  if (cousinGender === 'female' && personGender === 'male') {
    return order === 'elder' ? 'அண்ணன்' : order === 'younger' ? 'தம்பி' : 'அண்ணன்/தம்பி';
  }
  return null;
}

// True if root's CHILD is married to person's CHILD — the connection between
// the two sets of in-laws themselves, not between root and person's own blood
// lines. Neither root nor person is a blood relative of the other at all here.
function tamilIsSambandhi(persons, personId, rootId) {
  const root = getPerson(persons, rootId);
  if (!root) return false;
  return root.childrenIds.some((childId) => {
    const child = getPerson(persons, childId);
    const childSpouse = child?.spouseId ? getPerson(persons, child.spouseId) : null;
    return !!childSpouse?.parentIds.includes(personId);
  });
}

// root and person are both married INTO the same sibling group — Orambadi/
// Sagalai for two men married to sisters, Oppandhiyaar for two women married
// to brothers. (Mixed-gender pairs married to opposite-gender siblings are
// already covered elsewhere — e.g. husband's-brother's-wife is Anni via a
// different path — so this only fires for the two matching-gender cases.)
function tamilCoSiblingInLawTerm(persons, personId, rootId, rootGender, personGender) {
  const root = getPerson(persons, rootId);
  const person = getPerson(persons, personId);
  if (!root?.spouseId || !person?.spouseId || root.spouseId === personId || person.spouseId === rootId) return null;
  const ca = commonAncestor(persons, root.spouseId, person.spouseId);
  if (!ca || ca.distA !== 1 || ca.distB !== 1) return null;
  if (rootGender === 'male' && personGender === 'male') return 'ஓரம்படி/சகலை';
  if (rootGender === 'female' && personGender === 'female') return 'ஓப்பந்தியார்';
  return null;
}

// Marriage-based (in-law) Tamil term — mirrors inLawLabel's two-direction
// structure (person married into root's family, or person is kin of root's own
// spouse), plus two relationship types that aren't a "one marriage hop from a
// blood tie" at all: Sambandhi (the connection between root's and person's own
// families once their children marry each other) and co-sibling-in-law
// (Orambadi/Oppandhiyaar, two people married into the same sibling group).
function tamilInLawLabel(persons, personId, rootId, male, female) {
  const person = getPerson(persons, personId);
  const root = getPerson(persons, rootId);
  if (!person || !root) return null;
  const personGender = male ? 'male' : female ? 'female' : null;
  const candidates = [];

  // person's spouse is blood-related to root (person married INTO root's family).
  // Only for a genuine step-relation (personId has no recorded blood link of
  // their own) — skipped when personId is ALSO independently blood-related to
  // rootId, or an ordinary two-parent couple would double up: person.spouse
  // being the OTHER, blood-recorded parent duplicates the அப்பா/அம்மா that
  // tamilBloodLabelFromDistances already derives directly from personId's own
  // parentIds — see inLawLabel's matching guard for the English-side version
  // of this same bug ("Father / Father").
  if (person.spouseId && person.spouseId !== rootId && !commonAncestor(persons, personId, rootId)) {
    const spouse = getPerson(persons, person.spouseId);
    const ca = commonAncestor(persons, person.spouseId, rootId);
    if (ca && spouse) {
      const { distA: distSP, distB: distRoot, ancestorId } = ca;
      let term = null;
      if (distSP === 0) {
        term = tamilAncestorSpouseTerm(distRoot, male, female);
      } else if (distRoot === 0) {
        term = tamilInLawTermMarriedIn(distSP, distRoot, male, female);
      } else if (distRoot === 1 && distSP === 1) {
        term = tamilSiblingSpouseTerm(persons, ancestorId, rootId, person.spouseId, personGender);
      } else if (distSP === 1 && distRoot === 2) {
        term = tamilUncleAuntPairTerm(persons, rootId, ancestorId, person.spouseId, personGender);
      } else if (distSP === 1 && distRoot > 2) {
        term = personGender === 'male' ? 'தொலைவு மாமா' : personGender === 'female' ? 'தொலைவு அத்தை' : null;
      } else if (distSP === 2 && distRoot === 2) {
        // person's spouse is root's 1st cousin — parallel (same-side) cousins
        // are treated as siblings (see tamilBloodLabelFromDistances), so their
        // spouse gets the same Anni/Mama/Marumagal/Maapillai term a sibling's
        // spouse would; cross-cousins (Machaan/Machinichi) are married-in on
        // both sides, so DOB decides an Akka/Thangai/Anna/Thambi term instead.
        const cousinParent = tamilConnectingChild(persons, ancestorId, person.spouseId, distSP);
        const rootParent = tamilConnectingChild(persons, ancestorId, rootId, distRoot);
        const cousinParentGender = cousinParent ? getPerson(persons, cousinParent)?.gender : null;
        const rootParentGender = rootParent ? getPerson(persons, rootParent)?.gender : null;
        if (cousinParentGender && rootParentGender) {
          if (cousinParentGender === rootParentGender) {
            const order = tamilBirthOrder(persons, ancestorId, cousinParent, rootParent);
            term = tamilSiblingSpouseTermFromOrder(spouse.gender, order, personGender);
          } else {
            term = tamilCrossCousinSpouseTerm(persons, personId, rootId, spouse.gender, personGender);
          }
        }
      } else if (distSP === 2 && distRoot === 3) {
        // person's spouse plays a Periyappa/Chithappa role one generation
        // further removed (a grand-uncle/aunt's own child) — reuses the same
        // Periyamma/Chithi-Sinnamma pattern a direct uncle/aunt's wife gets,
        // via tamilRemovedUncleAuntPairTerm's own side/order comparison.
        term = tamilRemovedUncleAuntPairTerm(persons, rootId, ancestorId, person.spouseId, personGender);
      }
      if (term) candidates.push({ term, cost: distSP + distRoot });
    }
  }

  // person is blood-related to root's own spouse (root married INTO person's family).
  if (root.spouseId && root.spouseId !== personId) {
    const ca = commonAncestor(persons, personId, root.spouseId);
    if (ca) {
      const { distA: distPersonToAnc, distB: distRS, ancestorId } = ca;
      let term = null;
      if (distPersonToAnc === 0) {
        if (distRS === 1) term = male ? 'மாமனார்' : female ? 'மாமியார்' : 'மாமனார்/மாமியார்';
        else term = 'பாட்டன்/பாட்டி வழி';
      } else if (distPersonToAnc === 1 && distRS === 1) {
        const order = tamilBirthOrder(persons, ancestorId, personId, root.spouseId);
        if (root.gender === 'male') {
          // root is the husband; person is his wife's sibling.
          if (personGender === 'male') term = order === 'younger' ? 'மச்சான்' : order === 'elder' ? 'மச்சினன்' : 'மனைவியின் சகோதரர்';
          if (personGender === 'female') term = order === 'younger' ? 'கொழுந்தி' : order === 'elder' ? 'அண்ணி' : 'மனைவியின் சகோதரி';
        } else if (root.gender === 'female') {
          // root is the wife; person is her husband's sibling.
          if (personGender === 'male') term = order === 'younger' ? 'கொழுந்தன்' : order === 'elder' ? 'மாமா' : 'கணவரின் சகோதரர்';
          if (personGender === 'female') term = 'நாத்தனார்';
        }
      } else if (distPersonToAnc === 1 && distRS === 2) {
        // invertSide=true — see tamilUncleAuntPairTerm's own comment: a
        // spouse's maternal uncle is addressed as if paternal-side (Mama ->
        // Periyappa/Chithappa) and vice versa, once you've married in.
        term = tamilUncleAuntPairTerm(persons, root.spouseId, ancestorId, personId, personGender, 2, null, false, true);
      } else if (distPersonToAnc === 1 && distRS > 2) {
        term = personGender === 'male' ? 'தொலைவு மாமா' : personGender === 'female' ? 'தொலைவு அத்தை' : null;
      } else if (distPersonToAnc === 2 && distRS === 2) {
        // A CHILD of root's spouse's uncle/aunt (e.g. Kesavamoorthy's own
        // child, or Narayanan Family's own child, relative to Soundari) —
        // same generation as root's spouse relative to their shared
        // ancestor, exactly like a 1st cousin. Mirrors tamilUncleAuntPairTerm's
        // own invertSide logic one generation down, for BOTH directions:
        // TRUE-cross to root's spouse (Kesavamoorthy is Velmurugan's
        // mother's BROTHER) becomes sibling-treated for root (Anna/Thambi/
        // Akka/Thangai), using the same elder/younger order that decided the
        // uncle's own Periyappa/Chithappa-vs-Mama status; TRUE-parallel to
        // root's spouse (Narayanan Family is Velmurugan's father's BROTHER,
        // say — a real parallel cousin of Velmurugan's) becomes CROSS for
        // root instead — a cross-cousin (Machaan/Machinichi), the same word
        // a true blood cross-cousin gets, with no elder/younger distinction
        // (matching how that term already works for a direct cross-cousin).
        const rootParent = tamilConnectingChild(persons, ancestorId, root.spouseId, 2);
        const personParent = tamilConnectingChild(persons, ancestorId, personId, 2);
        const rootParentGender = rootParent ? getPerson(persons, rootParent)?.gender : null;
        const personParentGender = personParent ? getPerson(persons, personParent)?.gender : null;
        if (rootParentGender && personParentGender) {
          if (rootParentGender !== personParentGender) {
            const order = tamilBirthOrder(persons, ancestorId, personParent, rootParent);
            if (male) term = order === 'elder' ? 'அண்ணன்' : order === 'younger' ? 'தம்பி' : 'சகோதரன்';
            if (female) term = order === 'elder' ? 'அக்கா' : order === 'younger' ? 'தங்கை' : 'சகோதரி';
          } else {
            term = male ? 'மைத்துனன்/மச்சான்' : female ? 'மைத்துனி/மச்சினிச்சி' : 'மச்சான்/மச்சினிச்சி';
          }
        }
      } else if (distPersonToAnc === 2 && distRS === 1) {
        // root's spouse's sibling's own child (e.g. your wife's sister's
        // child, like Janakiraman & Dhivya's child relative to root) — Tamil
        // treats them as your own (Magan/Magal), the same way Annan/Anni's
        // own children already would be if they were a direct sibling.
        term = male ? 'மகன்' : female ? 'மகள்' : 'மகன்/மகள்';
      } else if (distPersonToAnc === 3 && distRS === 2) {
        // A CHILD of root's spouse's 1st-cousin-in-law (e.g. Iniya, whose
        // mother Sowmiya is Soundari's cousin-in-law) — mirrors the blood
        // "cousin's own child" branch (tamilBloodLabelFromDistances,
        // distRoot===2 && distPerson===3) exactly, just measured from
        // root.spouseId instead of rootId: own-line (Magan/Magal) vs
        // cross-line (Marumagan/Marumagal) depends on whether the connecting
        // cousin's OWN gender matches the "TRUE-parallel-to-root's-spouse"
        // classification (see the distPersonToAnc===2 branch's own comment
        // on why cross-to-spouse is what makes someone sibling-treated here).
        const rootParent = tamilConnectingChild(persons, ancestorId, root.spouseId, 2);
        const cousinParent = tamilConnectingChild(persons, ancestorId, personId, 3);
        const rootParentGender = rootParent ? getPerson(persons, rootParent)?.gender : null;
        const cousinParentGender = cousinParent ? getPerson(persons, cousinParent)?.gender : null;
        if (rootParentGender && cousinParentGender) {
          const isParallel = rootParentGender === cousinParentGender;
          const cousin = tamilConnectingChild(persons, cousinParent, personId, 2);
          const cousinGender = cousin ? getPerson(persons, cousin)?.gender : null;
          if (cousinGender) {
            const ownLine = isParallel ? cousinGender === 'male' : cousinGender === 'female';
            if (!ownLine) term = male ? 'மருமகன்' : female ? 'மருமகள்' : 'மருமகன்/மருமகள்';
            else term = male ? 'மகன்' : female ? 'மகள்' : 'மகன்/மகள்';
          }
        }
      }
      if (term) candidates.push({ term, cost: distPersonToAnc + distRS });
    }
  }

  // person's own spouse is a SIBLING of root's own spouse — e.g. person married
  // root's wife's elder sister. The wife's-sibling branch above only labels
  // that sibling herself (Anni, if she's elder); this labels HER husband too,
  // with the mirrored sibling term — an Anni's husband is Annan, wherever an
  // elder wife's-sister is Anni to a male root.
  if (root.spouseId && person.spouseId && person.spouseId !== rootId && person.spouseId !== root.spouseId) {
    const inLawSibling = getPerson(persons, person.spouseId);
    const ca3 = commonAncestor(persons, person.spouseId, root.spouseId);
    if (root.gender === 'male' && inLawSibling?.gender === 'female' && ca3 && ca3.distA === 1 && ca3.distB === 1) {
      const order = tamilBirthOrder(persons, ca3.ancestorId, person.spouseId, root.spouseId);
      if (order === 'elder') candidates.push({ term: 'அண்ணன்', cost: 3 });
    }
    // person's own spouse is UNCLE/AUNT-level blood-related to root's own
    // spouse (e.g. Vanaja, married to Kesavamoorthy who is Soundari's
    // husband's mother's brother) — mirrors the direct "root's spouse's
    // uncle/aunt" branch above (distPersonToAnc===1 && distRS===2), one
    // marriage hop further via person's own spouse. Was previously
    // unhandled entirely, leaving the badge blank.
    if (ca3 && ca3.distA === 1 && ca3.distB === 2) {
      const term4 = tamilUncleAuntPairTerm(persons, root.spouseId, ca3.ancestorId, person.spouseId, personGender, 2, null, false, true);
      if (term4) candidates.push({ term: term4, cost: ca3.distA + ca3.distB + 1 });
    }
  }

  if (tamilIsSambandhi(persons, personId, rootId) || tamilIsSambandhi(persons, rootId, personId)) {
    candidates.push({ term: 'சம்பந்தி', cost: 4 });
  }

  const coTerm = tamilCoSiblingInLawTerm(persons, personId, rootId, root.gender, person.gender);
  if (coTerm) candidates.push({ term: coTerm, cost: 4 });

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0].term;
}

// Tamil counterpart to getRelationshipLabel — same structure (blood label, in-law
// label, joined with " / " if both apply), but in Tamil terms that track side and
// birth order where English doesn't. Meant to be shown ALONGSIDE the English
// label (before it), not as a replacement — see PersonDetail's relationshipLabel.
// The full direct computation (blood + in-law + overrides + uncle/aunt
// dynamic pairing) — everything getRelationshipLabelTamil used to do before
// the generic spousal-mirror fallback below was added. Split out so that
// fallback can call this WITHOUT itself invoking the fallback again (calling
// the exported function recursively here would let two spouses who both lack
// a direct term send it looping between them forever).
function computePrimaryTamilTerm(persons, personId, rootId, overrides) {
  if (!personId || !rootId || personId === rootId) return null;
  const person = getPerson(persons, personId);
  const root = getPerson(persons, rootId);
  if (!person || !root) return null;

  if (person.spouseId === rootId) {
    if (person.gender === 'male') return 'கணவர்';
    if (person.gender === 'female') return 'மனைவி';
    return 'வாழ்க்கைத் துணை';
  }

  // User-authored corrections (see getRelationshipSignature below) take
  // priority over the computed default, for any relationship shape someone
  // has explicitly fixed via PersonDetail's edit affordance.
  if (overrides.length) {
    const signature = getRelationshipSignature(persons, personId, rootId);
    const hit = signature && overrides.find((o) => o.signature && signatureFingerprint(o.signature) === signatureFingerprint(signature));
    if (hit) return hit.term;

    // Dynamic pairing: personId is the MARRIED-IN half of an uncle/aunt pair
    // (an uncle's wife, or Vanaja married to root's spouse's uncle) — if the
    // BLOOD half has its own rule (e.g. Mama -> Periyappa), mirror it through
    // the pair table so the wife follows automatically (-> Periyamma)
    // without needing a second rule. See UNCLE_AUNT_PAIR_MAP's own comment
    // for why this is scoped to only these unambiguous words.
    const bloodHalfKind = signature && BLOOD_HALF_KIND[signature.kind];
    if (bloodHalfKind && signature.side != null && signature.relGender) {
      const bloodSignature2 = fillSignature(bloodHalfKind, {
        distA: signature.distA,
        distB: signature.distB,
        side: signature.side,
        order: signature.order,
        rootGender: signature.rootGender,
        gender: signature.relGender,
      });
      const bloodFp = signatureFingerprint(bloodSignature2);
      const bloodHit = overrides.find((o) => o.signature && signatureFingerprint(o.signature) === bloodFp);
      const mapped = bloodHit && UNCLE_AUNT_PAIR_MAP[bloodHit.term];
      if (mapped) return mapped;
    }
  }

  const male = person.gender === 'male';
  const female = person.gender === 'female';

  const ca = commonAncestor(persons, personId, rootId);
  const blood = ca
    ? tamilBloodLabelFromDistances(persons, personId, rootId, ca.distA, ca.distB, male, female, ca.ancestorId)
    : null;
  const inLaw = tamilInLawLabel(persons, personId, rootId, male, female);

  const parts = [blood, inLaw].filter(Boolean);
  return parts.length ? parts.join(' / ') : null;
}

// Sibling-family and uncle/aunt-family words only — deliberately excludes
// Thambi/Marumagal-style pairs that mean different things in OTHER contexts
// (see UNCLE_AUNT_PAIR_MAP's own comment) EXCEPT here it's safe to be a
// little more generous: this table only ever fires as a LAST RESORT, after
// every dedicated branch has already returned null for personId directly —
// it can only fill a gap, never override a real computed answer, so a
// slightly-approximate guess (correctable via the Relationship Rules panel)
// beats a permanently blank badge.
const SPOUSE_MIRROR_MAP = {
  'அண்ணன்': 'அண்ணி',
  'அக்கா': 'மாமா',
  'தம்பி': 'மருமகள்',
  'தங்கை': 'மாப்பிள்ளை',
  'மாமா': 'அத்தை',
  'அத்தை': 'மாமா',
  'தாய் மாமா': 'அத்தை',
  'பெரியப்பா': 'பெரியம்மா',
  'பெரியம்மா': 'பெரியப்பா',
  'சித்தப்பா': 'சித்தி/சின்னம்மா',
  'சித்தி/சின்னம்மா': 'சித்தப்பா',
};

// Every word eligible for the sibling-inheritance fallback below — the same
// sibling/uncle-family set SPOUSE_MIRROR_MAP covers, plus the cross-cousin
// pair (மைத்துனன்/மச்சான், மைத்துனி/மச்சினிச்சி), which SPOUSE_MIRROR_MAP itself
// doesn't map (that pair's spouse uses the DOB-based rule instead — see
// getRelationshipLabelTamil) but is still a legitimate word to inherit as-is.
const KNOWN_FAMILY_WORDS = new Set([
  ...Object.keys(SPOUSE_MIRROR_MAP),
  'மைத்துனன்/மச்சான்',
  'மைத்துனி/மச்சினிச்சி',
]);

// Same-role gender counterpart for every word in KNOWN_FAMILY_WORDS — e.g.
// அண்ணன்/அக்கா are both "elder sibling", differing only by the SPEAKER's own
// gender, not by anything about the sibling being inherited from. Needed
// because fallback #2 below used to return a sibling's own term verbatim: a
// woman married to a cross-cousin correctly gets தங்கை (younger sister,
// matches her own gender), but her BROTHER — who has no direct relation of
// his own and only reaches this fallback via her — was inheriting that same
// female-only word unchanged, showing தங்கை for a man (a real, reported bug).
// Now the inherited term's ROLE/CATEGORY carries over, but the actual word is
// re-picked for personId's own gender, the same way fallback #3 just below
// already does for parent-category inheritance.
const SIBLING_TERM_GENDER_PAIRS = {
  'அண்ணன்': { male: 'அண்ணன்', female: 'அக்கா' },
  'அக்கா': { male: 'அண்ணன்', female: 'அக்கா' },
  'தம்பி': { male: 'தம்பி', female: 'தங்கை' },
  'தங்கை': { male: 'தம்பி', female: 'தங்கை' },
  'மாமா': { male: 'மாமா', female: 'அத்தை' },
  'அத்தை': { male: 'மாமா', female: 'அத்தை' },
  'தாய் மாமா': { male: 'தாய் மாமா', female: 'அத்தை' },
  'பெரியப்பா': { male: 'பெரியப்பா', female: 'பெரியம்மா' },
  'பெரியம்மா': { male: 'பெரியப்பா', female: 'பெரியம்மா' },
  'சித்தப்பா': { male: 'சித்தப்பா', female: 'சித்தி/சின்னம்மா' },
  'சித்தி/சின்னம்மா': { male: 'சித்தப்பா', female: 'சித்தி/சின்னம்மா' },
  'மைத்துனன்/மச்சான்': { male: 'மைத்துனன்/மச்சான்', female: 'மைத்துனி/மச்சினிச்சி' },
  'மைத்துனி/மச்சினிச்சி': { male: 'மைத்துனன்/மச்சான்', female: 'மைத்துனி/மச்சினிச்சி' },
};

// Used by getRelationshipLabelTamil's fallback #3 (a parent with no blood
// path of their own either) to decide whether THEIR child is a cross-cousin
// or sibling-treated, purely from which word-family the parent's own term
// belongs to — see that fallback's own comment for the reasoning.
const CROSS_UNCLE_AUNT_WORDS = new Set(['மாமா', 'அத்தை', 'தாய் மாமா']);
const SAME_SIDE_UNCLE_AUNT_WORDS = new Set(['பெரியப்பா', 'பெரியம்மா', 'சித்தப்பா', 'சித்தி/சின்னம்மா']);
// A chained (non-blood-path) cross-cousin — Vinoth, whose own term only
// exists via fallback #3 on his father Amirthalingam — has no common
// ancestor with root either, so his own children can't reuse the
// same-line/cross-line ownLine test a direct cross-cousin's child gets
// (tamilInLawLabel's distPersonToAnc===3&&distRS===2 branch). மருமகன்/
// மருமகள் (nephew/niece) is the cross-line outcome of that same test —
// picked here as the single generic default rather than a compound string,
// matching how fallback #3 above already collapses missing order info to
// one plain word (சகோதரன்/சகோதரி) instead of listing every possibility.
const CROSS_COUSIN_WORDS = new Set(['மைத்துனன்/மச்சான்', 'மைத்துனி/மச்சினிச்சி']);

// The full chained resolution — primary computation, then three generic
// fallbacks that all recurse into EACH OTHER (a spouse's term might itself
// only exist via sibling-inheritance; a sibling's term might itself only
// exist via their own spouse; etc.), so a real chain of any length resolves
// correctly no matter which fallback each individual hop needs. `visiting`
// is a Set of personIds already being resolved in this call stack — every
// hop is a marriage or blood link, and REAL families are acyclic through
// those (you can't be your own ancestor or your own spouse's spouse), so the
// only way this set ever matters is genuinely circular data; it exists
// purely to stop that from infinite-looping mutual spouses/siblings, not
// because legitimate chains are expected to revisit anyone.
function resolveTamilTermChained(persons, personId, rootId, overrides, visiting) {
  // A person's relationship to themselves is never a real thing to compute —
  // computePrimaryTamilTerm already returns null for this below, but the
  // fallback layers don't independently know that: fallback #2, for
  // instance, walks personId's OWN siblings and returns THEIR (perfectly
  // valid) term relative to root — which, when personId === rootId, means
  // returning your own sibling's term as if it were your relationship to
  // yourself (e.g. viewing your own profile showing you tagged as your
  // sister's term, "Sister (to you)"). Short-circuiting here, before any
  // fallback runs, is the only place that's true for every fallback at once.
  if (personId === rootId) return null;
  if (visiting.has(personId)) return null;
  visiting.add(personId);
  try {
    const primary = computePrimaryTamilTerm(persons, personId, rootId, overrides);
    if (primary) return primary;

    const person = getPerson(persons, personId);
    if (!person) return null;

    // Fallback #1: personId's SPOUSE'S term (their own, or itself chained
    // through fallback #2/#3) is a known sibling/uncle-family word — mirror
    // it. E.g. Suriya, married to Vinoth, who only has a term via HIS
    // father Amirthalingam, who only has a term via HIS brother Shankar.
    if (person.spouseId && person.spouseId !== rootId) {
      const spouseTerm = resolveTamilTermChained(persons, person.spouseId, rootId, overrides, visiting);
      // A cross-cousin's own spouse (e.g. Suriya, or Sangeeta married to
      // Murugesh) — no shared-parent birth order to reuse (married in), same
      // as a direct cross-cousin's spouse, so this reuses that exact
      // DOB-based rule instead of a fixed word mapping.
      const spouse = getPerson(persons, person.spouseId);
      if (spouseTerm === 'மைத்துனன்/மச்சான்' || spouseTerm === 'மைத்துனி/மச்சினிச்சி') {
        const crossTerm = tamilCrossCousinSpouseTerm(persons, personId, rootId, spouse?.gender, person.gender);
        if (crossTerm) return crossTerm;
      }
      const mapped = SPOUSE_MIRROR_MAP[spouseTerm];
      if (mapped) return mapped;
    }

    // Fallback #2: personId is the SIBLING of someone who married into
    // root's family — Tamil treats that whole sibling group uniformly
    // rather than computing each one individually by birth order (unlike a
    // REAL blood uncle/aunt's own siblings, who each get their own distinct
    // Periyappa/Chithappa).
    for (const sibling of getSiblings(persons, person)) {
      const siblingTerm = resolveTamilTermChained(persons, sibling.id, rootId, overrides, visiting);
      if (!siblingTerm || !KNOWN_FAMILY_WORDS.has(siblingTerm)) continue;
      const pair = SIBLING_TERM_GENDER_PAIRS[siblingTerm];
      return person.gender === 'male' ? pair.male : person.gender === 'female' ? pair.female : siblingTerm;
    }

    // Fallback #3: personId's own PARENT is a Mama/Athai/Periyappa/
    // Chithappa-type relative with no blood path of their own either (e.g.
    // Vinoth, whose father Amirthalingam only has a term via HIS brother
    // Shankar). No common ancestor exists to compute a real side/order from,
    // but the parent's own term CATEGORY already answers the only question
    // that matters: a cross-side parent (Mama/Athai/Thai Mama — always
    // married-in or opposite-gender-sibling relatives) makes their child a
    // cross-cousin (Machaan/Machinichi) by the same convention a direct
    // cross-uncle's child already follows; a same-side parent (Periyappa/
    // Chithappa/Periyamma/Chithi) makes their child sibling-treated, though
    // without birth-order data to pick Anna vs Thambi, this falls back to
    // the plain சகோதரன்/சகோதரி word the direct sibling branch itself uses
    // when order can't be determined either.
    for (const parentId of person.parentIds) {
      const parentTerm = resolveTamilTermChained(persons, parentId, rootId, overrides, visiting);
      if (CROSS_UNCLE_AUNT_WORDS.has(parentTerm)) {
        return person.gender === 'male' ? 'மைத்துனன்/மச்சான்'
          : person.gender === 'female' ? 'மைத்துனி/மச்சினிச்சி'
          : 'மச்சான்/மச்சினிச்சி';
      }
      if (SAME_SIDE_UNCLE_AUNT_WORDS.has(parentTerm)) {
        return person.gender === 'male' ? 'சகோதரன்' : person.gender === 'female' ? 'சகோதரி' : 'உடன்பிறப்பு';
      }
      if (CROSS_COUSIN_WORDS.has(parentTerm)) {
        return person.gender === 'male' ? 'மருமகன்' : person.gender === 'female' ? 'மருமகள்' : 'மருமகன்/மருமகள்';
      }
    }
    return null;
  } finally {
    visiting.delete(personId);
  }
}

export function getRelationshipLabelTamil(persons, personId, rootId, overrides = []) {
  return resolveTamilTermChained(persons, personId, rootId, overrides, new Set());
}

// --- Custom relationship-term rules -----------------------------------------
// Lets a user correct a wrong Tamil term (via PersonDetail's edit affordance)
// in a way that applies to every pair of people anywhere in the tree sharing
// the same relationship SHAPE, not just the two people being viewed — e.g.
// "grandfather's brother's daughter is Athai" should fix every such pair, not
// one specific grandfather. getRelationshipSignature independently re-derives
// just the discriminating inputs (distance to a common ancestor, side, gender,
// birth order, same/cross-line) that getRelationshipLabelTamil's own branches
// above already key on — deliberately NOT a richer genealogy fingerprint than
// what a given branch actually consults, so two different real families
// collapse onto the same signature exactly when the engine already treats
// them identically today. This is purely ADDITIVE (calls the same private
// helpers the term-computation functions above already use) and doesn't
// modify any of them — zero regression risk to the tuned terms above, but
// also means any future change to those branches' conditions needs a
// matching update here, or a rule can silently stop matching (or over-match).

function fillSignature(kind, fields = {}) {
  return {
    kind,
    distA: fields.distA ?? null,
    distB: fields.distB ?? null,
    gender: fields.gender ?? null,
    relGender: fields.relGender ?? null,
    rootGender: fields.rootGender ?? null,
    side: fields.side ?? null,
    order: fields.order ?? null,
    lineMatch: fields.lineMatch ?? null,
  };
}

// Dynamic pairing for the uncle/aunt word family — if someone corrects the
// BLOOD half of a pair (e.g. Mama -> Periyappa), their spouse's term should
// follow automatically (Athai -> Periyamma) without a separate rule. Scoped
// deliberately narrow: only these unambiguous, single-purpose words — NOT
// Thambi/Marumagal or Thangai/Maapillai, which mean different things in
// OTHER contexts (e.g. an actual daughter-in-law) and would false-match if
// used as a blind reverse-lookup table here.
const UNCLE_AUNT_PAIR_MAP = {
  'மாமா': 'அத்தை',
  'அத்தை': 'மாமா',
  'தாய் மாமா': 'அத்தை',
  'பெரியப்பா': 'பெரியம்மா',
  'பெரியம்மா': 'பெரியப்பா',
  'சித்தப்பா': 'சித்தி/சின்னம்மா',
  'சித்தி/சின்னம்மா': 'சித்தப்பா',
  'சின்னம்மா': 'சித்தப்பா',
};

// Maps "the married-in half's" kind to "the blood/directly-related half's"
// kind for the SAME uncle/aunt shape — e.g. an uncle's wife (inlaw-married-in)
// pairs with the uncle himself (blood); Vanaja (inlaw-co-spouse-uncle) pairs
// with Kesavamoorthy (inlaw-spouse-kin). Only defined for kinds that can
// represent an uncle/aunt shape (checked via `side !== null` at the call site
// below, since these kinds ALSO cover non-uncle/aunt shapes).
const BLOOD_HALF_KIND = {
  'inlaw-married-in': 'blood',
  'inlaw-co-spouse-uncle': 'inlaw-spouse-kin',
};

// Mirrors tamilBloodLabelFromDistances' own branches 1:1 (see that function
// for the reasoning behind each — comments aren't repeated here).
function bloodSignature(persons, personId, rootId, ca, gender) {
  const { ancestorId, distA: distPerson, distB: distRoot } = ca;

  if (distRoot === distPerson) {
    if (distRoot === 1) {
      const order = tamilBirthOrder(persons, ancestorId, personId, rootId);
      return fillSignature('blood', { distA: distPerson, distB: distRoot, gender, order });
    }
    if (distRoot === 2) {
      const rootParent = tamilConnectingChild(persons, ancestorId, rootId, 2);
      const personParent = tamilConnectingChild(persons, ancestorId, personId, 2);
      const rootParentGender = rootParent ? getPerson(persons, rootParent)?.gender : null;
      const personParentGender = personParent ? getPerson(persons, personParent)?.gender : null;
      if (rootParentGender && personParentGender) {
        const lineMatch = rootParentGender === personParentGender ? 'same' : 'cross';
        const order = lineMatch === 'same' ? tamilBirthOrder(persons, ancestorId, personParent, rootParent) : null;
        return fillSignature('blood', { distA: distPerson, distB: distRoot, gender, lineMatch, order });
      }
    }
    return fillSignature('blood', { distA: distPerson, distB: distRoot, gender });
  }
  if (distRoot < distPerson) {
    if (distRoot === 1 && distPerson === 2) {
      const connecting = tamilConnectingChild(persons, ancestorId, personId, distPerson);
      const connectingGender = connecting ? getPerson(persons, connecting)?.gender : null;
      const rootGender = getPerson(persons, rootId)?.gender ?? null;
      const lineMatch = connectingGender && rootGender ? (connectingGender === rootGender ? 'same' : 'cross') : null;
      return fillSignature('blood', { distA: distPerson, distB: distRoot, gender, lineMatch });
    }
    if (distRoot === 2 && distPerson === 3) {
      const rootParent = tamilConnectingChild(persons, ancestorId, rootId, 2);
      const cousinParent = tamilConnectingChild(persons, ancestorId, personId, 3);
      const rootParentGender = rootParent ? getPerson(persons, rootParent)?.gender : null;
      const cousinParentGender = cousinParent ? getPerson(persons, cousinParent)?.gender : null;
      if (rootParentGender && cousinParentGender) {
        const isParallel = rootParentGender === cousinParentGender;
        const cousin = tamilConnectingChild(persons, cousinParent, personId, 2);
        const cousinGender = cousin ? getPerson(persons, cousin)?.gender : null;
        if (cousinGender) {
          const ownLine = isParallel ? cousinGender === 'male' : cousinGender === 'female';
          return fillSignature('blood', { distA: distPerson, distB: distRoot, gender, lineMatch: ownLine ? 'same' : 'cross' });
        }
      }
    }
    return fillSignature('blood', { distA: distPerson, distB: distRoot, gender });
  }
  if (distPerson < distRoot) {
    if (distPerson === 1 && distRoot === 2) {
      const side = tamilSideFromRoot(persons, rootId, ancestorId);
      const connectingParent = tamilConnectingChild(persons, ancestorId, rootId, 2);
      const order = connectingParent ? tamilBirthOrder(persons, ancestorId, personId, connectingParent) : null;
      return fillSignature('blood', { distA: distPerson, distB: distRoot, gender, side, order });
    }
    if (distPerson === 2 && distRoot === 3) {
      const connectingSibling = tamilConnectingChild(persons, ancestorId, personId, 2);
      if (connectingSibling) {
        const side = tamilSideFromRoot(persons, rootId, ancestorId);
        const connectingParent = tamilConnectingChild(persons, ancestorId, rootId, 3);
        const order = connectingParent ? tamilBirthOrder(persons, ancestorId, connectingSibling, connectingParent) : null;
        return fillSignature('blood', { distA: distPerson, distB: distRoot, gender, side, order });
      }
    }
  }
  // Straight ancestor/descendant line, distant cousins, or an indeterminate
  // side/order within one of the buckets above — the bucket itself (distA,
  // distB) is the whole discriminator, matching that branch's own fallback.
  return fillSignature('blood', { distA: distPerson, distB: distRoot, gender });
}

// Mirrors tamilInLawLabel's "person's spouse is blood-related to root" branch
// 1:1 (person married into root's family, or person's spouse IS a direct
// ancestor of root — e.g. a grandfather's wife).
function inLawMarriedInSignature(persons, personId, rootId, ca, gender) {
  const { ancestorId, distA: distSP, distB: distRoot } = ca;
  const person = getPerson(persons, personId);
  const spouse = getPerson(persons, person.spouseId);
  if (!spouse) return null;
  const relGender = spouse.gender ?? null;

  if (distSP === 0 || distRoot === 0) {
    return fillSignature('inlaw-married-in', { distA: distSP, distB: distRoot, gender });
  }
  if (distRoot === 1 && distSP === 1) {
    const order = tamilBirthOrder(persons, ancestorId, person.spouseId, rootId);
    return fillSignature('inlaw-married-in', { distA: distSP, distB: distRoot, gender, relGender, order });
  }
  if (distSP === 1 && distRoot === 2) {
    const side = tamilSideFromRoot(persons, rootId, ancestorId);
    const connectingParent = tamilConnectingChild(persons, ancestorId, rootId, 2);
    const order = connectingParent ? tamilBirthOrder(persons, ancestorId, person.spouseId, connectingParent) : null;
    return fillSignature('inlaw-married-in', { distA: distSP, distB: distRoot, gender, relGender, side, order });
  }
  if (distSP === 1 && distRoot > 2) {
    return fillSignature('inlaw-married-in', { distA: distSP, distB: distRoot, gender });
  }
  if (distSP === 2 && distRoot === 2) {
    const cousinParent = tamilConnectingChild(persons, ancestorId, person.spouseId, distSP);
    const rootParent = tamilConnectingChild(persons, ancestorId, rootId, distRoot);
    const cousinParentGender = cousinParent ? getPerson(persons, cousinParent)?.gender : null;
    const rootParentGender = rootParent ? getPerson(persons, rootParent)?.gender : null;
    if (cousinParentGender && rootParentGender) {
      const lineMatch = cousinParentGender === rootParentGender ? 'same' : 'cross';
      const order = lineMatch === 'same'
        ? tamilBirthOrder(persons, ancestorId, cousinParent, rootParent)
        : tamilAgeOrder(persons, personId, rootId);
      return fillSignature('inlaw-married-in', { distA: distSP, distB: distRoot, gender, relGender, lineMatch, order });
    }
    return null;
  }
  if (distSP === 2 && distRoot === 3) {
    const connectingSibling = tamilConnectingChild(persons, ancestorId, person.spouseId, 2);
    if (connectingSibling) {
      const side = tamilSideFromRoot(persons, rootId, ancestorId);
      const connectingParent = tamilConnectingChild(persons, ancestorId, rootId, 3);
      const order = connectingParent ? tamilBirthOrder(persons, ancestorId, connectingSibling, connectingParent) : null;
      return fillSignature('inlaw-married-in', { distA: distSP, distB: distRoot, gender, relGender, side, order });
    }
    return null;
  }
  return null;
}

// Mirrors tamilInLawLabel's "person is blood-related to root's own spouse"
// branch 1:1 (root married into person's family).
function inLawSpouseKinSignature(persons, personId, rootId, ca, gender) {
  const { ancestorId, distA: distPersonToAnc, distB: distRS } = ca;
  const root = getPerson(persons, rootId);

  if (distPersonToAnc === 0 || (distPersonToAnc === 1 && distRS > 2) || (distPersonToAnc === 2 && distRS === 1)) {
    return fillSignature('inlaw-spouse-kin', { distA: distPersonToAnc, distB: distRS, gender });
  }
  if (distPersonToAnc === 1 && distRS === 1) {
    const order = tamilBirthOrder(persons, ancestorId, personId, root.spouseId);
    return fillSignature('inlaw-spouse-kin', { distA: distPersonToAnc, distB: distRS, gender, rootGender: root.gender ?? null, order });
  }
  if (distPersonToAnc === 1 && distRS === 2) {
    // Inverted to match tamilUncleAuntPairTerm's own invertSide — a spouse's
    // maternal uncle is addressed as if paternal-side once you've married in.
    let side = tamilSideFromRoot(persons, root.spouseId, ancestorId);
    if (side) side = side === 'paternal' ? 'maternal' : 'paternal';
    const connectingParent = tamilConnectingChild(persons, ancestorId, root.spouseId, 2);
    const order = connectingParent ? tamilBirthOrder(persons, ancestorId, personId, connectingParent) : null;
    return fillSignature('inlaw-spouse-kin', { distA: distPersonToAnc, distB: distRS, gender, side, order });
  }
  if (distPersonToAnc === 2 && distRS === 2) {
    // A child of root's spouse's uncle/aunt (root's spouse's 1st cousin) —
    // lineMatch reflects the ALREADY-INVERTED classification (see the
    // matching term-computation in tamilInLawLabel): 'same' when the
    // underlying line is TRUE-cross to root's spouse (sibling-treated for
    // root, e.g. Kesavamoorthy's child), 'cross' the other way around.
    const rootParent = tamilConnectingChild(persons, ancestorId, root.spouseId, 2);
    const personParent = tamilConnectingChild(persons, ancestorId, personId, 2);
    const rootParentGender = rootParent ? getPerson(persons, rootParent)?.gender : null;
    const personParentGender = personParent ? getPerson(persons, personParent)?.gender : null;
    if (rootParentGender && personParentGender) {
      const lineMatch = rootParentGender !== personParentGender ? 'same' : 'cross';
      const order = lineMatch === 'same' ? tamilBirthOrder(persons, ancestorId, personParent, rootParent) : null;
      return fillSignature('inlaw-spouse-kin', { distA: distPersonToAnc, distB: distRS, gender, lineMatch, order });
    }
  }
  return null;
}

// Classification key capturing exactly the discriminating inputs
// getRelationshipLabelTamil's branches use to pick a term for (personId,
// rootId) — NOT the term itself. Returns null for the root themselves, an
// unrelated/unrecorded pair, missing ids, or a direct spouse (not
// customizable in V1 — கணவர்/மனைவி is unambiguous already). Blood always
// takes priority whenever a common ancestor exists at all, matching
// getRelationshipLabelTamil's own priority (blood is never null once an
// ancestor is found; in-law is appended separately, not cost-compared
// against it) — a rule keyed to the blood signature can't independently
// target just the in-law half of a rare compound "blood / in-law" pair, an
// accepted limitation.
export function getRelationshipSignature(persons, personId, rootId) {
  if (!personId || !rootId || personId === rootId) return null;
  const person = getPerson(persons, personId);
  const root = getPerson(persons, rootId);
  if (!person || !root) return null;
  if (person.spouseId === rootId) return null;

  const gender = person.gender === 'male' ? 'male' : person.gender === 'female' ? 'female' : null;

  const bloodCa = commonAncestor(persons, personId, rootId);
  if (bloodCa) return bloodSignature(persons, personId, rootId, bloodCa, gender);

  const candidates = [];

  if (person.spouseId && person.spouseId !== rootId) {
    const ca = commonAncestor(persons, person.spouseId, rootId);
    if (ca) {
      const sig = inLawMarriedInSignature(persons, personId, rootId, ca, gender);
      if (sig) candidates.push({ sig, cost: ca.distA + ca.distB });
    }
  }

  if (root.spouseId && root.spouseId !== personId) {
    const ca = commonAncestor(persons, personId, root.spouseId);
    if (ca) {
      const sig = inLawSpouseKinSignature(persons, personId, rootId, ca, gender);
      if (sig) candidates.push({ sig, cost: ca.distA + ca.distB });
    }
  }

  if (root.spouseId && person.spouseId && person.spouseId !== rootId && person.spouseId !== root.spouseId) {
    const inLawSibling = getPerson(persons, person.spouseId);
    const ca = commonAncestor(persons, person.spouseId, root.spouseId);
    if (root.gender === 'male' && inLawSibling?.gender === 'female' && ca && ca.distA === 1 && ca.distB === 1) {
      const order = tamilBirthOrder(persons, ca.ancestorId, person.spouseId, root.spouseId);
      if (order === 'elder') {
        candidates.push({
          sig: fillSignature('inlaw-co-spouse', { distA: 1, distB: 1, gender, relGender: 'female', rootGender: 'male', order: 'elder' }),
          cost: 3,
        });
      }
    }
    // Mirrors the new uncle/aunt-level co-spouse branch in tamilInLawLabel
    // (e.g. Vanaja, married to root's spouse's mother's brother) — side
    // inverted the same way tamilUncleAuntPairTerm's invertSide is.
    if (ca && ca.distA === 1 && ca.distB === 2) {
      let side = tamilSideFromRoot(persons, root.spouseId, ca.ancestorId);
      if (side) side = side === 'paternal' ? 'maternal' : 'paternal';
      const connectingParent = tamilConnectingChild(persons, ca.ancestorId, root.spouseId, 2);
      const order = connectingParent ? tamilBirthOrder(persons, ca.ancestorId, person.spouseId, connectingParent) : null;
      candidates.push({
        sig: fillSignature('inlaw-co-spouse-uncle', { distA: 1, distB: 2, gender, relGender: inLawSibling?.gender ?? null, side, order }),
        cost: 4,
      });
    }
  }

  if (tamilIsSambandhi(persons, personId, rootId) || tamilIsSambandhi(persons, rootId, personId)) {
    candidates.push({ sig: fillSignature('sambandhi'), cost: 4 });
  }

  if (tamilCoSiblingInLawTerm(persons, personId, rootId, root.gender, person.gender)) {
    candidates.push({ sig: fillSignature('co-sibling-in-law', { gender, rootGender: root.gender ?? null }), cost: 4 });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0].sig;
}

const SIGNATURE_FIELDS = ['kind', 'distA', 'distB', 'gender', 'relGender', 'rootGender', 'side', 'order', 'lineMatch'];

// An explicit fixed-field-order tuple, NOT a sorted-keys JSON.stringify of the
// raw object — Firestore doesn't guarantee a map field's key order round-trips
// identically to how it was written, so comparing by insertion order would be
// unreliable for a signature read back from a saved rule.
export function signatureFingerprint(signature) {
  if (!signature) return null;
  return JSON.stringify(SIGNATURE_FIELDS.map((f) => signature[f] ?? null));
}

let idCounter = 0;

// Generates an id not present in the given persons map.
export function generateId(persons) {
  let candidate;
  do {
    idCounter += 1;
    candidate = `p${String(Date.now()).slice(-6)}${idCounter}`;
  } while (persons[candidate]);
  return candidate;
}

export function createEmptyPerson(id) {
  return {
    id,
    firstName: '',
    lastName: '',
    petName: '',
    gender: 'other',
    dob: '',
    dod: '',
    isAlive: true,
    work: '',
    location: '',
    locationLat: null,
    locationLng: null,
    // Stamped true only by an approximate (non-precise) GPS fix — see
    // LocationInput's GPS_COARSE_ACCURACY_M — so it's visible on the person's
    // own record to whoever looks later, not just as a one-time toast to
    // whoever happened to be entering it.
    locationApproximate: false,
    phone: '',
    email: '',
    photo: '',
    notes: '',
    spouseId: '',
    marriageDate: '',
    parentIds: [],
    childrenIds: [],
  };
}

const REQUIRED_PERSON_FIELDS = ['id', 'firstName', 'lastName', 'gender'];

// Validates the shape of imported data. Returns { valid, error }.
export function validateFamilyData(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'File is not a valid JSON object.' };
  }
  if (!data.persons || typeof data.persons !== 'object') {
    return { valid: false, error: 'Missing "persons" object.' };
  }
  const ids = Object.keys(data.persons);
  if (ids.length === 0) {
    return { valid: false, error: 'The family has no people.' };
  }
  for (const id of ids) {
    const person = data.persons[id];
    for (const field of REQUIRED_PERSON_FIELDS) {
      if (!person[field]) {
        return { valid: false, error: `Person "${id}" is missing "${field}".` };
      }
    }
    if (person.id !== id) {
      return { valid: false, error: `Person key "${id}" does not match its id "${person.id}".` };
    }
  }
  if (data.rootPersonId && !data.persons[data.rootPersonId]) {
    return { valid: false, error: 'rootPersonId does not refer to a known person.' };
  }
  return { valid: true, error: null };
}

// Full array of ids from personId up through parentIds[0] to the top of their
// primary blood line (dad-line priority, same convention as primaryLineageRoot) —
// used to highlight a single person's lineage-to-root path in the tree view.
export function getAncestorChain(persons, personId) {
  const chain = [];
  let current = getPerson(persons, personId);
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    chain.push(current.id);
    visited.add(current.id);
    current = getPerson(persons, current.parentIds[0]);
  }
  return chain;
}

// Full ordered chain of ids connecting idA to idB, for the "Find Connection"
// path highlight/travel feature — a plain shortest-path BFS over the WHOLE
// family graph, where every parent/child AND spouse link is a traversable edge.
// This is deliberately not "find the common ancestor" — two people are very
// often connected only through a marriage that sits somewhere in the MIDDLE of
// the path (e.g. two people whose families are linked because a cousin on one
// side married a cousin on the other), not through a shared blood ancestor or a
// spouse hop at either endpoint. BFS finds that automatically, and always finds
// the shortest such path, without needing to special-case which combination of
// blood/marriage hops connects them. Returns null only if they're in genuinely
// disconnected parts of the tree.
export function getRelationshipPath(persons, idA, idB) {
  if (!idA || !idB || !persons[idA] || !persons[idB]) return null;
  if (idA === idB) return [idA];

  const cameFrom = new Map([[idA, null]]);
  const queue = [idA];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === idB) break;
    const person = getPerson(persons, current);
    if (!person) continue;
    const neighbors = [...person.parentIds, ...person.childrenIds];
    if (person.spouseId) neighbors.push(person.spouseId);
    for (const next of neighbors) {
      if (!persons[next] || cameFrom.has(next)) continue;
      cameFrom.set(next, current);
      queue.push(next);
    }
  }

  if (!cameFrom.has(idB)) return null;
  const path = [];
  for (let current = idB; current !== null; current = cameFrom.get(current)) {
    path.unshift(current);
  }
  return path;
}

// Deepest generation count reachable from a single root (1 = the root alone).
function maxDepthFrom(persons, id, visited = new Set()) {
  if (visited.has(id)) return 0;
  visited.add(id);
  const person = getPerson(persons, id);
  if (!person) return 0;
  let maxChildDepth = 0;
  for (const childId of person.childrenIds) {
    maxChildDepth = Math.max(maxChildDepth, maxDepthFrom(persons, childId, visited));
  }
  return 1 + maxChildDepth;
}

// One-pass summary of the whole dataset for the stats bar/panel.
export function computeFamilyStats(persons) {
  const all = Object.values(persons);
  const totalMembers = all.length;
  let males = 0;
  let females = 0;
  let other = 0;
  let alive = 0;
  let deceased = 0;
  let lifespanSum = 0;
  let lifespanCount = 0;
  let mapped = 0;
  const lastNameCounts = new Map();
  const workCounts = new Map();
  const countedCouples = new Set();
  let marriedCouples = 0;
  let verifiedProfiles = 0;
  let withPhoto = 0;

  all.forEach((p) => {
    if (p.gender === 'male') males += 1;
    else if (p.gender === 'female') females += 1;
    else other += 1;

    if (p.isAlive) alive += 1;
    else deceased += 1;

    if (p.verifiedEmail) verifiedProfiles += 1;

    if (!p.isAlive) {
      const age = getAgeInfo(p);
      if (age && age.label === 'Lived') {
        lifespanSum += age.value;
        lifespanCount += 1;
      }
    }

    if (p.locationLat != null && p.locationLng != null) mapped += 1;
    if (p.photo) withPhoto += 1;

    const lastName = p.lastName?.trim();
    if (lastName) lastNameCounts.set(lastName, (lastNameCounts.get(lastName) || 0) + 1);

    const work = p.work?.trim();
    if (work) workCounts.set(work, (workCounts.get(work) || 0) + 1);

    if (p.spouseId && persons[p.spouseId]) {
      const pairKey = [p.id, p.spouseId].sort().join('|');
      if (!countedCouples.has(pairKey)) {
        countedCouples.add(pairKey);
        marriedCouples += 1;
      }
    }
  });

  const topN = (map, n = 5) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

  const roots = getForestRoots(persons);
  const generationCount = roots.reduce((max, r) => Math.max(max, maxDepthFrom(persons, r)), 0);

  return {
    totalMembers,
    males,
    females,
    other,
    alive,
    deceased,
    avgLifespanYears: lifespanCount ? Math.round((lifespanSum / lifespanCount) * 10) / 10 : null,
    avgLifespanSampleSize: lifespanCount,
    verifiedProfiles,
    generationCount,
    mapped,
    withPhoto,
    topLastNames: topN(lastNameCounts),
    // Sorted by count desc then alphabetically — usually more titles than fit a
    // color-coded chart legibly, so this feeds a plain ranked list, not a chart.
    workBreakdown: [...workCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([work, count]) => ({ work, count })),
    peopleWithWork: [...workCounts.values()].reduce((sum, c) => sum + c, 0),
    marriedCouples,
  };
}
