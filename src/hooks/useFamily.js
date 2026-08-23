import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, runTransaction, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import seedData from '../data/family.json';
import { createEmptyPerson, generateId } from '../utils/familyUtils';

// The whole tree lives in ONE shared Firestore document, so every signed-in device
// reads/writes the same data in real time. localStorage is no longer the store — the
// Firestore SDK's own offline cache keeps things working without a connection.
const FAMILY_DOC = ['families', 'main'];

// Deep clone so callers never mutate React state directly.
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// The shared tree is edited by any signed-in family member, so stamp who/when
// on each record they change (email matches the app's admin-by-email model;
// epoch ms sorts and formats cleanly) — surfaced in PersonDetail so a later
// viewer can see who last touched a record.
function editStamp() {
  const u = auth.currentUser;
  return { lastEditedBy: u?.email || '', lastEditedAt: Date.now() };
}

export function useFamily() {
  const [persons, setPersons] = useState({});
  const [rootPersonId, setRootPersonId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saved'
  const [authed, setAuthed] = useState(() => !!auth.currentUser);
  // The persons map / rootPersonId as of the last successful sync with Firestore
  // (either a remote update we just received, or our own last write) — the
  // baseline the debounced save below diffs local state against to figure out
  // what THIS device actually changed, rather than blindly overwriting the
  // whole shared document (see the save effect for why that matters).
  const lastSyncedPersons = useRef({});
  const lastSyncedRoot = useRef(null);
  const saveTimer = useRef(null);

  // Kept in sync so history snapshots always capture the true current state,
  // regardless of which mutator's stale useCallback closure calls pushHistory.
  const personsRef = useRef(persons);
  useEffect(() => {
    personsRef.current = persons;
  }, [persons]);

  // Current root as a ref too — the snapshot listener's closure (below) is
  // created once and would otherwise read a stale rootPersonId.
  const rootPersonIdRef = useRef(rootPersonId);
  useEffect(() => {
    rootPersonIdRef.current = rootPersonId;
  }, [rootPersonId]);

  // Undo/redo covers data edits only (add/update/delete/link/import) — NOT
  // setRoot or view-mode changes, which live outside useFamily entirely.
  const historyRef = useRef({ past: [], future: [] });
  const HISTORY_LIMIT = 50;
  const pushHistory = useCallback(() => {
    const { past } = historyRef.current;
    past.push(clone(personsRef.current));
    if (past.length > HISTORY_LIMIT) past.shift();
    historyRef.current.future = [];
  }, []);

  // Load once: prefer stored data, fall back to bundled seed.
  useEffect(() => onAuthStateChanged(auth, (u) => setAuthed(!!u)), []);

  // Live subscription to the shared family document (starts once signed in).
  useEffect(() => {
    if (!authed) return undefined;
    const ref = doc(db, ...FAMILY_DOC);
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          // First-ever load: seed the shared doc from the bundled data.
          setDoc(ref, clone(seedData)).catch((err) => console.error('Failed to seed shared family doc:', err));
          return;
        }
        if (snap.metadata.hasPendingWrites) return; // ignore our own optimistic echo
        const data = snap.data();
        const serverPersons = data.persons || {};
        const serverRoot = data.rootPersonId || Object.keys(serverPersons)[0] || null;

        // Preserve edits made locally but not yet saved (the save below is
        // debounced ~700ms): overlay the records THIS device changed/deleted
        // since the last sync onto the incoming server data, rather than
        // replacing local state wholesale. Without this, a snapshot arriving
        // mid-edit — another member's change, or a slightly-delayed echo of an
        // earlier edit of ours — wipes a just-made change (most visibly a child
        // reorder), forcing the user to redo it. Same per-record reference-diff
        // the save effect uses, so it's exactly the set still waiting to be written.
        const cur = personsRef.current || {};
        const base = lastSyncedPersons.current || {};
        const locallyChanged = Object.keys(cur).filter((id) => cur[id] !== base[id]);
        const locallyDeleted = Object.keys(base).filter((id) => !(id in cur));
        const mergedPersons = { ...serverPersons };
        locallyChanged.forEach((id) => {
          mergedPersons[id] = cur[id];
        });
        locallyDeleted.forEach((id) => {
          delete mergedPersons[id];
        });
        const rootChangedLocally = rootPersonIdRef.current !== lastSyncedRoot.current;

        // Baseline tracks what's actually on the server now; the preserved local
        // edits stay pending, so the save effect diffs them against this and writes them.
        lastSyncedPersons.current = serverPersons;
        lastSyncedRoot.current = serverRoot;
        setPersons(mergedPersons);
        setRootPersonId(rootChangedLocally ? rootPersonIdRef.current : serverRoot);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [authed]);

  // Debounced write of local edits back to the shared doc. Diffs local state
  // against the last-synced baseline (reference equality — every mutator above
  // makes a NEW object only for the person(s) it actually touches, so an
  // untouched person keeps the exact same reference) to find which specific
  // records THIS device changed, then merges just those into whatever's
  // CURRENTLY on the server inside a transaction — instead of blindly
  // overwriting the whole document with a `setDoc`. Two relatives editing
  // DIFFERENT people at the same time no longer silently clobber each other's
  // changes. (Two edits to the exact SAME person at the same moment still
  // resolve last-write-wins for that one record — true field-level merging
  // would need a much bigger rework — but that's a far narrower window than
  // every unrelated change on the whole tree getting wiped out.)
  useEffect(() => {
    if (loading || !authed || !rootPersonId) return undefined;
    const baselinePersons = lastSyncedPersons.current;
    const baselineRoot = lastSyncedRoot.current;
    const baselineIds = Object.keys(baselinePersons);
    const localIds = Object.keys(persons);
    const unchanged =
      rootPersonId === baselineRoot &&
      localIds.length === baselineIds.length &&
      localIds.every((id) => persons[id] === baselinePersons[id]);
    if (unchanged) return undefined;

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const localPersons = persons;
      const localRoot = rootPersonId;
      const changedIds = localIds.filter((id) => persons[id] !== baselinePersons[id]);
      const deletedIds = baselineIds.filter((id) => !(id in localPersons));
      const rootChangedLocally = localRoot !== baselineRoot;
      // Guessed eagerly so a second edit made while this save is still in
      // flight diffs against this point rather than re-sending it — corrected
      // for real once the snapshot listener echoes back the committed result.
      lastSyncedPersons.current = localPersons;
      lastSyncedRoot.current = localRoot;

      const ref = doc(db, ...FAMILY_DOC);
      runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const serverData = snap.exists() ? snap.data() : {};
        const merged = { ...(serverData.persons || {}) };
        changedIds.forEach((id) => {
          merged[id] = localPersons[id];
        });
        deletedIds.forEach((id) => {
          delete merged[id];
        });
        const mergedRoot = rootChangedLocally ? localRoot : (serverData.rootPersonId ?? localRoot);
        tx.set(ref, { rootPersonId: mergedRoot, persons: merged });
      })
        .then(() => {
          setSaveState('saved');
          setTimeout(() => setSaveState('idle'), 1500);
        })
        .catch((err) => console.error('Failed to save family data:', err));
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [persons, rootPersonId, loading, authed]);

  const addPerson = useCallback((partial) => {
    let newId;
    pushHistory();
    setPersons((prev) => {
      newId = generateId(prev);
      const person = { ...createEmptyPerson(newId), ...partial, id: newId, ...editStamp() };
      return { ...prev, [newId]: person };
    });
    return newId;
  }, [pushHistory]);

  const updatePerson = useCallback((id, updates) => {
    pushHistory();
    setPersons((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], ...updates, ...editStamp() } };
    });
  }, [pushHistory]);

  // Applies many people's updates as ONE undo step — e.g. "fill in every
  // missing surname across the tree" touching a dozen people at once should
  // undo in one press, not require pressing Undo a dozen times because each
  // person went through its own separate updatePerson/pushHistory call.
  const bulkUpdatePersons = useCallback((updatesById) => {
    pushHistory();
    setPersons((prev) => {
      const next = { ...prev };
      for (const [id, updates] of Object.entries(updatesById)) {
        if (next[id]) next[id] = { ...next[id], ...updates, ...editStamp() };
      }
      return next;
    });
  }, [pushHistory]);

  // Removes a person and scrubs every reference to them.
  const deletePerson = useCallback((id) => {
    pushHistory();
    setPersons((prev) => {
      if (!prev[id]) return prev;
      const next = {};
      for (const [pid, person] of Object.entries(prev)) {
        if (pid === id) continue;
        next[pid] = {
          ...person,
          spouseId: person.spouseId === id ? '' : person.spouseId,
          marriageDate: person.spouseId === id ? '' : person.marriageDate,
          parentIds: person.parentIds.filter((p) => p !== id),
          childrenIds: person.childrenIds.filter((c) => c !== id),
        };
      }
      return next;
    });
    setRootPersonId((prevRoot) => {
      if (prevRoot !== id) return prevRoot;
      const remaining = Object.keys(persons).filter((p) => p !== id);
      return remaining[0] || null;
    });
  }, [persons]);

  // Creates a child linked to the parent and the parent's spouse (if any).
  const addChild = useCallback((parentId, partial = {}) => {
    let newId;
    pushHistory();
    setPersons((prev) => {
      const parent = prev[parentId];
      if (!parent) return prev;
      newId = generateId(prev);
      const parentPair = [parentId];
      if (parent.spouseId && prev[parent.spouseId]) parentPair.push(parent.spouseId);

      // Convention: a child's surname is the father's (male parent's) first name.
      const father = parentPair.map((pid) => prev[pid]).find((p) => p && p.gender === 'male');
      const child = {
        ...createEmptyPerson(newId),
        lastName: father ? father.firstName : parent.lastName,
        ...partial,
        id: newId,
        parentIds: parentPair,
        ...editStamp(),
      };
      const next = { ...prev, [newId]: child };
      for (const pid of parentPair) {
        next[pid] = { ...next[pid], childrenIds: [...next[pid].childrenIds, newId] };
      }
      return next;
    });
    return newId;
  }, [pushHistory]);

  // Creates a spouse and links both people to each other.
  const addSpouse = useCallback((personId, partial = {}) => {
    let newId;
    pushHistory();
    setPersons((prev) => {
      const person = prev[personId];
      if (!person || person.spouseId) return prev;
      newId = generateId(prev);
      const spouse = {
        ...createEmptyPerson(newId),
        lastName: person.lastName,
        ...partial,
        id: newId,
        spouseId: personId,
        ...editStamp(),
      };
      return {
        ...prev,
        [newId]: spouse,
        [personId]: { ...person, spouseId: newId },
      };
    });
    return newId;
  }, [pushHistory]);

  // Creates a parent linked to the person; pairs them with an existing spouseless parent.
  const addParent = useCallback((personId, partial = {}) => {
    let newId;
    pushHistory();
    setPersons((prev) => {
      const person = prev[personId];
      if (!person || person.parentIds.length >= 2) return prev;
      newId = generateId(prev);
      const parent = {
        ...createEmptyPerson(newId),
        lastName: person.lastName,
        ...partial,
        id: newId,
        childrenIds: [personId],
        ...editStamp(),
      };
      const next = {
        ...prev,
        [newId]: parent,
        [personId]: { ...person, parentIds: [...person.parentIds, newId] },
      };
      const existingParentId = person.parentIds[0];
      if (existingParentId && next[existingParentId] && !next[existingParentId].spouseId) {
        next[existingParentId] = { ...next[existingParentId], spouseId: newId };
        next[newId] = { ...next[newId], spouseId: existingParentId };
      }
      return next;
    });
    return newId;
  }, [pushHistory]);

  // Creates a sibling sharing the same parent(s). If personId has no recorded
  // parents yet (e.g. a lineage root), auto-creates a shared "Unknown Parent"
  // placeholder first (see TreeNode's isPlaceholder branch) so the sibling has
  // somewhere to attach without inventing a fake, fully-specified parent.
  const addSibling = useCallback((personId, partial = {}) => {
    let newId;
    pushHistory();
    setPersons((prev) => {
      const person = prev[personId];
      if (!person) return prev;
      let next = prev;
      let parentIds = person.parentIds;

      if (parentIds.length === 0) {
        const placeholderId = generateId(next);
        const placeholder = {
          ...createEmptyPerson(placeholderId),
          firstName: 'Unknown',
          lastName: person.lastName,
          isPlaceholder: true,
          childrenIds: [personId],
        };
        next = {
          ...next,
          [placeholderId]: placeholder,
          [personId]: { ...person, parentIds: [placeholderId] },
        };
        parentIds = [placeholderId];
      }

      newId = generateId(next);
      const sibling = {
        ...createEmptyPerson(newId),
        lastName: person.lastName,
        ...partial,
        id: newId,
        parentIds: [...parentIds],
        ...editStamp(),
      };
      next = { ...next, [newId]: sibling };
      // Prepended, not appended — left is the father/blood-lineage side of the
      // tree, and a new sibling should land there rather than off to the right.
      for (const pid of parentIds) {
        if (next[pid]) next[pid] = { ...next[pid], childrenIds: [newId, ...next[pid].childrenIds] };
      }
      return next;
    });
    return newId;
  }, [pushHistory]);

  // Wires up a relationship between two ALREADY-EXISTING people (no new person
  // created), mirroring addParent/addSpouse/addChild/addSibling's edge-setting —
  // used by PersonForm's "Link Existing" tab. Eligibility (no cycles, no
  // duplicate roles) is enforced upstream by familyUtils' getEligibleLinkCandidates.
  const linkExisting = useCallback((personId, relation, existingId) => {
    pushHistory();
    setPersons((prev) => {
      const person = prev[personId];
      const other = prev[existingId];
      if (!person || !other) return prev;
      let next = prev;

      if (relation === 'spouse') {
        next = {
          ...next,
          [personId]: { ...person, spouseId: existingId },
          [existingId]: { ...other, spouseId: personId },
        };
      } else if (relation === 'parent') {
        next = {
          ...next,
          [personId]: { ...person, parentIds: [...person.parentIds, existingId] },
          [existingId]: { ...other, childrenIds: [...other.childrenIds, personId] },
        };
        const existingParentId = person.parentIds[0];
        if (existingParentId && next[existingParentId] && !next[existingParentId].spouseId && !next[existingId].spouseId) {
          next[existingParentId] = { ...next[existingParentId], spouseId: existingId };
          next[existingId] = { ...next[existingId], spouseId: existingParentId };
        }
      } else if (relation === 'child') {
        const parentPair = [personId];
        if (person.spouseId && next[person.spouseId]) parentPair.push(person.spouseId);
        next = {
          ...next,
          [existingId]: { ...other, parentIds: [...new Set([...other.parentIds, ...parentPair])] },
        };
        for (const pid of parentPair) {
          next[pid] = { ...next[pid], childrenIds: [...next[pid].childrenIds, existingId] };
        }
      } else if (relation === 'sibling') {
        let parentIds = person.parentIds;
        if (parentIds.length === 0) {
          const placeholderId = generateId(next);
          const placeholder = {
            ...createEmptyPerson(placeholderId),
            firstName: 'Unknown',
            lastName: person.lastName,
            isPlaceholder: true,
            childrenIds: [personId],
          };
          next = { ...next, [placeholderId]: placeholder, [personId]: { ...person, parentIds: [placeholderId] } };
          parentIds = [placeholderId];
        }
        next = { ...next, [existingId]: { ...next[existingId], parentIds: [...parentIds] } };
        for (const pid of parentIds) {
          next[pid] = { ...next[pid], childrenIds: [existingId, ...next[pid].childrenIds] };
        }
      }

      return next;
    });
  }, [pushHistory]);

  // Replaces an auto-created "Unknown Parent" placeholder (see addSibling above)
  // with an already-recorded real person, once it turns out that real person was
  // already added to the tree separately — used by fillPlaceholderParent's own
  // "Link Existing" tab. Re-parents every one of the placeholder's children onto
  // the real person (not just one, since a placeholder can be shared by an entire
  // sibling group) and then removes the now-redundant placeholder outright, rather
  // than leaving an orphaned stub behind.
  const mergePlaceholder = useCallback((placeholderId, existingId) => {
    pushHistory();
    setPersons((prev) => {
      const placeholder = prev[placeholderId];
      const existing = prev[existingId];
      if (!placeholder?.isPlaceholder || !existing) return prev;
      const kids = placeholder.childrenIds.filter((cid) => prev[cid]);
      const next = { ...prev };
      for (const cid of kids) {
        next[cid] = {
          ...next[cid],
          parentIds: next[cid].parentIds.map((pid) => (pid === placeholderId ? existingId : pid)),
        };
      }
      next[existingId] = { ...existing, childrenIds: [...new Set([...existing.childrenIds, ...kids])] };
      delete next[placeholderId];
      return next;
    });
  }, [pushHistory]);

  // Clears a mutual spouse link (both sides), including any recorded marriage date.
  // Neither person is deleted — just the relationship between them.
  const removeSpouse = useCallback((personId) => {
    pushHistory();
    setPersons((prev) => {
      const person = prev[personId];
      if (!person?.spouseId) return prev;
      const spouseId = person.spouseId;
      const next = { ...prev, [personId]: { ...person, spouseId: '', marriageDate: '' } };
      if (next[spouseId]) {
        next[spouseId] = { ...next[spouseId], spouseId: '', marriageDate: '' };
      }
      return next;
    });
  }, [pushHistory]);

  // Removes one specific parent-child edge (both directions) without touching any
  // other relationship — e.g. fixing a single wrongly-recorded parent while leaving
  // the other parent and all other relatives untouched.
  const removeParent = useCallback((personId, parentId) => {
    pushHistory();
    setPersons((prev) => {
      const person = prev[personId];
      if (!person || !person.parentIds.includes(parentId)) return prev;
      const next = {
        ...prev,
        [personId]: { ...person, parentIds: person.parentIds.filter((id) => id !== parentId) },
      };
      if (next[parentId]) {
        next[parentId] = {
          ...next[parentId],
          childrenIds: next[parentId].childrenIds.filter((id) => id !== personId),
        };
      }
      return next;
    });
  }, [pushHistory]);

  const removeChild = useCallback((personId, childId) => {
    pushHistory();
    setPersons((prev) => {
      const person = prev[personId];
      if (!person || !person.childrenIds.includes(childId)) return prev;
      const next = {
        ...prev,
        [personId]: { ...person, childrenIds: person.childrenIds.filter((id) => id !== childId) },
      };
      if (next[childId]) {
        next[childId] = {
          ...next[childId],
          parentIds: next[childId].parentIds.filter((id) => id !== personId),
        };
      }
      return next;
    });
  }, [pushHistory]);

  // Moves a child `steps` slots earlier/later among its siblings (defaults to
  // one step, for the up/down arrow buttons) — kept in sync across EVERY one of
  // the child's recorded parents (not just whichever parent's detail panel
  // triggered this), since both should agree on birth order. This is the only
  // place birth order is captured when exact DOB isn't known: childrenIds array
  // order doubles as both left-to-right tree position and, for the Tamil
  // elder/younger terms, birth order (eldest first). Dragging a child several
  // slots in one gesture (see PersonDetail's drag-and-drop) calls this ONCE with
  // steps > 1 rather than once per slot — each step pushes its own history
  // snapshot, so a multi-slot drag would otherwise burn through several undo
  // entries for what the user experiences as a single action.
  const reorderChild = useCallback((childId, direction, steps = 1) => {
    pushHistory();
    setPersons((prev) => {
      const child = prev[childId];
      if (!child) return prev;
      const next = { ...prev };
      let moved = false;
      for (let step = 0; step < steps; step += 1) {
        let movedThisStep = false;
        child.parentIds.forEach((parentId) => {
          const parent = next[parentId];
          if (!parent) return;
          const ids = [...parent.childrenIds];
          const idx = ids.indexOf(childId);
          const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
          if (idx === -1 || swapIdx < 0 || swapIdx >= ids.length) return;
          [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
          next[parentId] = { ...parent, childrenIds: ids };
          movedThisStep = true;
        });
        if (!movedThisStep) break;
        moved = true;
      }
      return moved ? next : prev;
    });
  }, [pushHistory]);

  const setRoot = useCallback((id) => {
    setRootPersonId((prev) => (persons[id] ? id : prev));
  }, [persons]);

  // Replaces the entire dataset (used by import). Assumes data is pre-validated.
  const replaceAll = useCallback((data) => {
    pushHistory();
    setPersons(clone(data.persons));
    setRootPersonId(data.rootPersonId || Object.keys(data.persons)[0] || null);
  }, [pushHistory]);

  // Restores the published seed (family.json), discarding local-only edits. Undoable.
  const resetToSeed = useCallback(() => {
    replaceAll(seedData);
  }, [replaceAll]);

  const exportData = useCallback(() => clone({ rootPersonId, persons }), [rootPersonId, persons]);

  // past/future are read directly off the ref (not state) — every push/pop
  // happens alongside a setPersons call, so the re-render it triggers always
  // sees up-to-date lengths here without a separate piece of state to sync.
  const undo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (past.length === 0) return;
    const previous = past.pop();
    future.push(clone(personsRef.current));
    setPersons(previous);
  }, []);

  const redo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (future.length === 0) return;
    const next = future.pop();
    past.push(clone(personsRef.current));
    setPersons(next);
  }, []);

  return {
    persons,
    rootPersonId,
    loading,
    saveState,
    addPerson,
    updatePerson,
    bulkUpdatePersons,
    deletePerson,
    addChild,
    addSpouse,
    addParent,
    addSibling,
    linkExisting,
    mergePlaceholder,
    removeSpouse,
    removeParent,
    removeChild,
    reorderChild,
    setRoot,
    replaceAll,
    resetToSeed,
    exportData,
    undo,
    redo,
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
  };
}
