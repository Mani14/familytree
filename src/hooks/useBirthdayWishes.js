import { useEffect, useState, useCallback } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

// Birthday wishes are a real collection (one doc per wish), not a field
// embedded in families/main or a single-doc array like relationshipOverrides
// — wishes accumulate indefinitely and firestore.rules needs to check each
// wish's OWN fromUid to decide who can delete it, which only a per-document
// rule (not a rule over one big array field) can express.
export function useBirthdayWishes(personId, user) {
  const [wishes, setWishes] = useState([]);
  const [wishesReady, setWishesReady] = useState(false);

  useEffect(() => {
    if (!personId) {
      setWishes([]);
      setWishesReady(true);
      return undefined;
    }
    setWishesReady(false);
    // No orderBy here on purpose — an equality filter combined with a sort on
    // a DIFFERENT field needs a Firestore composite index; sorting the
    // (always-small, per-person) result client-side avoids that deploy step
    // entirely.
    const q = query(collection(db, 'birthdayWishes'), where('personId', '==', personId));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setWishes(list);
        setWishesReady(true);
      },
      () => setWishesReady(true)
    );
  }, [personId]);

  const addWish = useCallback(
    (message) => {
      if (!user?.uid || !message.trim()) return Promise.resolve();
      return addDoc(collection(db, 'birthdayWishes'), {
        personId,
        message: message.trim(),
        fromUid: user.uid,
        fromName: user.name || 'A family member',
        createdAt: serverTimestamp(),
      });
    },
    [personId, user?.uid, user?.name]
  );

  const removeWish = useCallback((wishId) => deleteDoc(doc(db, 'birthdayWishes', wishId)), []);

  return { wishes, wishesReady, addWish, removeWish };
}
