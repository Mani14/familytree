import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

const OVERRIDES_DOC = ['families', 'relationshipOverrides'];

// Custom Tamil relationship-term rules — a SEPARATE doc from families/main,
// not a field on it: useFamily's own save effect does a full non-merge
// `tx.set(ref, { rootPersonId, persons })` on that doc, which would silently
// wipe any other top-level field added there. Mirrors useAppSettings.js's
// simple onSnapshot -> local state -> setDoc(merge:true) shape — rules are
// edited rarely, so the same last-write-wins race useAppSettings already
// accepts for its own fields is an acceptable tradeoff here too, rather than
// a full transaction like useFamily's persons map needs.
export function useRelationshipOverrides() {
  const [overrides, setOverrides] = useState([]);
  const [overridesReady, setOverridesReady] = useState(false);

  useEffect(() => {
    return onSnapshot(
      doc(db, ...OVERRIDES_DOC),
      (snap) => {
        setOverrides(snap.exists() ? snap.data().overrides || [] : []);
        setOverridesReady(true);
      },
      () => setOverridesReady(true)
    );
  }, []);

  const addOverride = useCallback((signature, term, label) => {
    const entry = {
      id: `ro_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      signature,
      term,
      label,
    };
    return setDoc(doc(db, ...OVERRIDES_DOC), { overrides: [...overrides, entry] }, { merge: true });
  }, [overrides]);

  const removeOverride = useCallback((id) => {
    return setDoc(doc(db, ...OVERRIDES_DOC), { overrides: overrides.filter((o) => o.id !== id) }, { merge: true });
  }, [overrides]);

  return { overrides, overridesReady, addOverride, removeOverride };
}
