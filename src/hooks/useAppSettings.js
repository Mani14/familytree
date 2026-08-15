import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

const SETTINGS_DOC = ['settings', 'app'];

const DEFAULTS = {
  defaultTheme: 'light',
  features: { familyMap: true, birthdayWidget: true, anniversaryWidget: true, showAges: true },
};

// App-wide settings, admin-editable, applied for every signed-in user —
// distinct from the per-account prefs in useAuth (meId/rootId) and the
// per-device theme choice in ThemeToggle's own localStorage.
export function useAppSettings() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    return onSnapshot(
      doc(db, ...SETTINGS_DOC),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setSettings({
          ...DEFAULTS,
          ...data,
          features: { ...DEFAULTS.features, ...(data.features || {}) },
        });
        setSettingsReady(true);
      },
      () => setSettingsReady(true)
    );
  }, []);

  // Returns the setDoc promise so callers can surface write failures (e.g. permission
  // denied when firestore.rules hasn't been deployed yet) instead of failing silently.
  const updateSettings = useCallback((partial) => {
    return setDoc(doc(db, ...SETTINGS_DOC), partial, { merge: true });
  }, []);

  return { settings, settingsReady, updateSettings };
}
