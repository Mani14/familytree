import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';

// Firebase-Auth (Google) gate for the app, plus two per-user preferences stored
// in Firestore (users/<uid>.meId, users/<uid>.rootId) so they follow you across
// devices without being shared with the rest of the family: which person is
// "you" and which person your own tree view defaults to. Everyone's own
// rootId is independent — one person setting theirs doesn't affect anyone
// else's (see App.jsx's effectiveRootId, which is what actually gets shown).
export function useAuth() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [meId, setMeId] = useState(null);
  const [myRootId, setMyRootId] = useState(null);
  // Distinguishes "meId hasn't loaded from Firestore yet" from "genuinely no
  // link exists" — meId is null in both cases, so callers that need to tell
  // a real never-linked user apart from an in-flight fetch (see App's
  // welcome-nudge effect) should gate on this too, not just !meId.
  const [meReady, setMeReady] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, email: u.email, name: u.displayName, picture: u.photoURL } : null);
      if (!u) {
        setMeId(null);
        setMyRootId(null);
        setMeReady(true); // signed out — nothing left to fetch
      } else {
        setMeReady(false); // about to fetch this account's own link
      }
      setAuthReady(true);
    });
  }, []);

  // Live per-user preferences.
  useEffect(() => {
    if (!user?.uid) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.exists() ? snap.data() : {};
      setMeId(data.meId ?? null);
      setMyRootId(data.rootId ?? null);
      setMeReady(true);
    });
  }, [user?.uid]);

  // Caches this account's own login email onto its users/<uid> doc — the
  // birthday-notification Worker cron reads Firestore only (it can't reach
  // Firebase Auth directly), so this is the one place that email needs to
  // live for the cron job to know where to send a "someone's birthday today"
  // email. Runs once per sign-in; harmless to re-run if the address changes.
  useEffect(() => {
    if (!user?.uid || !user.email) return;
    setDoc(doc(db, 'users', user.uid), { email: user.email }, { merge: true }).catch(() => {});
  }, [user?.uid, user?.email]);

  const signIn = useCallback(() => {
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(auth, googleProvider).catch(() => {});
  }, []);

  const signOut = useCallback(() => fbSignOut(auth), []);

  const setMe = useCallback(
    (personId) => {
      if (!user?.uid) return;
      setMeId(personId); // optimistic; the snapshot listener will confirm
      setDoc(doc(db, 'users', user.uid), { meId: personId ?? null }, { merge: true }).catch(() => {});
    },
    [user?.uid]
  );

  const setMyRoot = useCallback(
    (personId) => {
      if (!user?.uid) return;
      setMyRootId(personId); // optimistic; the snapshot listener will confirm
      setDoc(doc(db, 'users', user.uid), { rootId: personId ?? null }, { merge: true }).catch(() => {});
    },
    [user?.uid]
  );

  return {
    user,
    authReady,
    signIn,
    signOut,
    meId,
    meReady,
    myRootId,
    setMe,
    setMyRoot,
  };
}
