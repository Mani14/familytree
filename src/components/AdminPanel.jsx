import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { ShieldAlert, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { db } from '../lib/firebase';
import { getFullName, getPerson } from '../utils/familyUtils';
import Modal from './Modal';
import '../styles/AdminPanel.css';

// Admin-only settings: manage who else is an admin, app-wide defaults/feature
// toggles, a read-only view of which accounts are linked to whom, and the
// destructive "reset to seed" action — all gated behind isAdmin both here
// (UI) and in firestore.rules (server-side enforcement).
export default function AdminPanel({
  isOpen,
  onClose,
  persons,
  adminEmails,
  permanentAdminEmails,
  addAdmin,
  removeAdmin,
  settings,
  updateSettings,
  onRequestReset,
  onOpenDataHealth,
}) {
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [userLinks, setUserLinks] = useState(null); // null = not loaded yet
  const [settingsError, setSettingsError] = useState(null);

  // Surfaces write failures (e.g. permission-denied if firestore.rules hasn't been
  // deployed yet) instead of the checkbox silently reverting with no explanation.
  const handleUpdateSettings = (partial) => {
    setSettingsError(null);
    updateSettings(partial).catch((err) => setSettingsError(err.message || String(err)));
  };

  // Only queries the users collection while the panel is actually open — no
  // point holding a live listener (and the extra reads) the rest of the time.
  useEffect(() => {
    if (!isOpen) return undefined;
    return onSnapshot(
      collection(db, 'users'),
      (snap) => setUserLinks(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
      () => setUserLinks([])
    );
  }, [isOpen]);

  const linkedRows = useMemo(() => {
    if (!userLinks) return [];
    return userLinks.map((link) => ({
      uid: link.uid,
      mePerson: link.meId ? getFullName(getPerson(persons, link.meId)) : null,
      rootPerson: link.rootId ? getFullName(getPerson(persons, link.rootId)) : null,
    }));
  }, [userLinks, persons]);

  const handleAddAdmin = (e) => {
    e.preventDefault();
    if (!newAdminEmail.trim()) return;
    addAdmin(newAdminEmail);
    setNewAdminEmail('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Admin Settings" width="560px" className="admin-panel">
      <h2><ShieldAlert size={18} /> Admin Settings</h2>

      <section className="admin-section">
        <h3>Admins</h3>
        <ul className="admin-list">
          {permanentAdminEmails.map((email) => (
            <li key={email}>
              <span>{email}</span>
              <span className="admin-badge">Permanent</span>
            </li>
          ))}
          {adminEmails.map((email) => (
            <li key={email}>
              <span>{email}</span>
              <button type="button" className="admin-remove-btn" onClick={() => removeAdmin(email)} aria-label={`Remove admin ${email}`}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        <form className="admin-add-form" onSubmit={handleAddAdmin}>
          <input
            type="email"
            placeholder="someone@example.com"
            value={newAdminEmail}
            onChange={(e) => setNewAdminEmail(e.target.value)}
          />
          <button type="submit"><UserPlus size={14} /> Add Admin</button>
        </form>
      </section>

      <section className="admin-section">
        <h3>App-Wide Settings</h3>
        {settingsError && (
          <p className="admin-muted admin-error">Couldn't save: {settingsError}</p>
        )}
        <label className="admin-row">
          <span>Default theme for new visitors</span>
          <select
            value={settings.defaultTheme}
            onChange={(e) => handleUpdateSettings({ defaultTheme: e.target.value })}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="admin-row">
          <span>Family Map</span>
          <input
            type="checkbox"
            checked={settings.features.familyMap}
            onChange={(e) => handleUpdateSettings({ features: { ...settings.features, familyMap: e.target.checked } })}
          />
        </label>
        <label className="admin-row">
          <span>Birthday reminders</span>
          <input
            type="checkbox"
            checked={settings.features.birthdayWidget}
            onChange={(e) => handleUpdateSettings({ features: { ...settings.features, birthdayWidget: e.target.checked } })}
          />
        </label>
        <label className="admin-row">
          <span>Birthday reminder window (days in advance)</span>
          <input
            type="number"
            min="1"
            max="365"
            value={settings.birthdayWindowDays}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isNaN(value)) return;
              handleUpdateSettings({ birthdayWindowDays: Math.min(365, Math.max(1, value)) });
            }}
          />
        </label>
        <label className="admin-row">
          <span>Anniversary reminders</span>
          <input
            type="checkbox"
            checked={settings.features.anniversaryWidget}
            onChange={(e) => handleUpdateSettings({ features: { ...settings.features, anniversaryWidget: e.target.checked } })}
          />
        </label>
        <label className="admin-row">
          <span>Show ages (hides age & birth year, keeps birthday)</span>
          <input
            type="checkbox"
            checked={settings.features.showAges}
            onChange={(e) => handleUpdateSettings({ features: { ...settings.features, showAges: e.target.checked } })}
          />
        </label>
      </section>

      <section className="admin-section">
        <h3>Linked Accounts</h3>
        {!userLinks ? (
          <p className="admin-muted">Loading…</p>
        ) : linkedRows.length === 0 ? (
          <p className="admin-muted">No one has linked an account yet.</p>
        ) : (
          <ul className="admin-list admin-links-list">
            {linkedRows.map((row) => (
              <li key={row.uid}>
                <span className="admin-link-me">{row.mePerson || 'Not linked'}</span>
                {row.rootPerson && row.rootPerson !== row.mePerson && (
                  <span className="admin-link-root">viewing {row.rootPerson}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="admin-muted admin-note">
          Google email addresses of other accounts aren't readable from the browser —
          this shows which family member each signed-in account is linked to instead.
        </p>
      </section>

      <section className="admin-section">
        <h3>Data Quality</h3>
        <p className="admin-muted">Scan for broken or inconsistent relationships — dangling references, asymmetric links, unfilled placeholders.</p>
        <button type="button" className="admin-secondary-btn" onClick={onOpenDataHealth}>
          <ShieldCheck size={14} /> Open Data Health Check
        </button>
      </section>

      <section className="admin-section admin-danger-zone">
        <h3>Danger Zone</h3>
        <p className="admin-muted">Restore the published seed data, discarding everyone's local edits to the shared tree.</p>
        <button type="button" className="admin-danger-btn" onClick={onRequestReset}>
          <Trash2 size={14} /> Reset Shared Tree to Seed
        </button>
      </section>
    </Modal>
  );
}
