import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

// Always an admin regardless of what's in Firestore — guarantees the app can
// never end up with zero admins able to manage the rest of the admin list
// (mirrored server-side in firestore.rules' isAdmin()).
export const PERMANENT_ADMIN_EMAILS = ['manikandan.ks.14@gmail.com'];

const ADMINS_DOC = ['settings', 'admins'];

// Admin status is tied to the signed-in Google ACCOUNT (user.email from
// useAuth), not to any one person record in the tree — consistent with every
// other per-account thing this app tracks (meId, rootId).
export function useAdmin(user) {
  const [adminEmails, setAdminEmails] = useState([]);
  const [adminsReady, setAdminsReady] = useState(false);

  useEffect(() => {
    return onSnapshot(
      doc(db, ...ADMINS_DOC),
      (snap) => {
        setAdminEmails(snap.exists() ? snap.data().emails || [] : []);
        setAdminsReady(true);
      },
      () => setAdminsReady(true)
    );
  }, []);

  const email = user?.email?.toLowerCase() || null;
  const isAdmin = !!email && (PERMANENT_ADMIN_EMAILS.includes(email) || adminEmails.includes(email));

  const addAdmin = useCallback((newEmail) => {
    const clean = newEmail.trim().toLowerCase();
    if (!clean || PERMANENT_ADMIN_EMAILS.includes(clean) || adminEmails.includes(clean)) return;
    setDoc(doc(db, ...ADMINS_DOC), { emails: [...adminEmails, clean] }, { merge: true }).catch(() => {});
  }, [adminEmails]);

  const removeAdmin = useCallback((targetEmail) => {
    setDoc(doc(db, ...ADMINS_DOC), { emails: adminEmails.filter((e) => e !== targetEmail) }).catch(() => {});
  }, [adminEmails]);

  return { isAdmin, adminsReady, adminEmails, permanentAdminEmails: PERMANENT_ADMIN_EMAILS, addAdmin, removeAdmin };
}
