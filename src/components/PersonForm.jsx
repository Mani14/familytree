import { useMemo, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { getDisplayName, getEligibleLinkCandidates } from '../utils/familyUtils';
import LocationInput from './LocationInput';
import Modal from './Modal';
import '../styles/PersonForm.css';

const emptyForm = {
  firstName: '',
  lastName: '',
  petName: '',
  gender: 'male',
  dob: '',
  dod: '',
  isAlive: true,
  work: '',
  location: '',
  locationLat: null,
  locationLng: null,
  locationApproximate: false,
  phone: '',
  email: '',
  photo: '',
  notes: '',
  marriageDate: '',
};

// Avatars only ever render small (biggest is the ~56px detail-panel circle), but
// an unmodified phone photo can be several MB — and the whole family shares ONE
// Firestore document capped at 1MB total. A few full-resolution photos stored
// directly would blow past that and break saves for EVERYONE, not just whoever
// uploaded. Downscaling + re-encoding as JPEG here keeps each photo to roughly
// 15-40KB regardless of the original.
const MAX_PHOTO_DIMENSION = 320;
const PHOTO_JPEG_QUALITY = 0.82;

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read image'));
      img.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

// `persons`/`personId`/`relation`/`onLinkExisting` are only passed for add-relative flows
// (addParent/addSpouse/addChild/addSibling) — when present, a "Link Existing" tab lets the
// user attach an already-recorded person instead of creating a duplicate.
export default function PersonForm({
  title,
  initialPerson,
  showMarriageDate,
  onSave,
  onCancel,
  persons,
  personId,
  relation,
  onLinkExisting,
}) {
  const [form, setForm] = useState(() => ({ ...emptyForm, ...initialPerson }));
  const [error, setError] = useState('');
  const canLinkExisting = !!(relation && persons && personId && onLinkExisting);
  const [tab, setTab] = useState('new');
  const [linkQuery, setLinkQuery] = useState('');
  // Date of death is often only known to the year (e.g. from an old family
  // record) — this toggles the field between a full date picker and a plain
  // 4-digit year input, seeded from whatever shape the saved value already is.
  const [dodYearOnly, setDodYearOnly] = useState(() => /^\d{4}$/.test(initialPerson?.dod || ''));

  const candidates = useMemo(() => {
    if (!canLinkExisting || tab !== 'link') return [];
    const eligible = getEligibleLinkCandidates(persons, personId, relation);
    const term = linkQuery.trim().toLowerCase();
    const filtered = term ? eligible.filter((p) => getDisplayName(p).toLowerCase().includes(term)) : eligible;
    return filtered.slice(0, 20);
  }, [canLinkExisting, tab, persons, personId, relation, linkQuery]);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizePhoto(file);
      setField('photo', resized);
      setError('');
    } catch {
      setError('Could not process that photo — try a different one.');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.firstName.trim()) {
      setError('First name is required.');
      return;
    }
    onSave(form);
  };

  return (
    <Modal isOpen onClose={onCancel} title={title} width="560px">
      <form className="person-form" onSubmit={handleSubmit}>
        <h2>{title}</h2>
        {error && <p className="person-form-error">{error}</p>}

        {canLinkExisting && (
          <div className="person-form-tabs">
            <button type="button" className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>
              Create New
            </button>
            <button type="button" className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')}>
              Link Existing
            </button>
          </div>
        )}

        {tab === 'link' ? (
          <div className="person-form-link">
            <label>
              Search existing people
              <input
                type="text"
                autoFocus
                value={linkQuery}
                onChange={(e) => setLinkQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                placeholder="Type a name…"
              />
            </label>
            <ul className="person-form-link-results">
              {candidates.length > 0 ? (
                candidates.map((p) => (
                  <li key={p.id}>
                    <span>{getDisplayName(p)}</span>
                    <button type="button" onClick={() => onLinkExisting(p.id)}>Link</button>
                  </li>
                ))
              ) : (
                <li className="person-form-link-empty">
                  {linkQuery.trim() ? 'No eligible matches' : 'No eligible people to link'}
                </li>
              )}
            </ul>
            <div className="person-form-actions">
              <button type="button" onClick={onCancel}>Cancel</button>
            </div>
          </div>
        ) : (
        <>
        <div className="person-form-photo-section">
          <div className="person-form-photo-circle">
            {form.photo ? (
              <img src={form.photo} alt="" />
            ) : (
              <span className="person-form-photo-placeholder">
                {(form.firstName[0] || '') + (form.lastName[0] || '') || '?'}
              </span>
            )}
          </div>
          <div className="person-form-photo-actions">
            <label className="person-form-photo-update">
              <Camera size={13} /> Update Photo
              <input type="file" accept="image/*" onChange={handlePhotoChange} />
            </label>
            {form.photo && (
              <button type="button" className="person-form-photo-remove" onClick={() => setField('photo', '')}>
                Remove Photo
              </button>
            )}
          </div>
        </div>

        <div className="person-form-section">
          <span className="person-form-section-title">Basic info</span>
          <div className="person-form-row">
            <label>
              First name*
              <input
                value={form.firstName}
                onChange={(e) => setField('firstName', e.target.value)}
                autoCapitalize="words"
              />
            </label>
            <label>
              Last name (optional)
              <input
                value={form.lastName}
                onChange={(e) => setField('lastName', e.target.value)}
                autoCapitalize="words"
              />
            </label>
          </div>

          <label>
            Pet name (optional)
            <input
              value={form.petName}
              onChange={(e) => setField('petName', e.target.value)}
              autoCapitalize="words"
            />
          </label>

          <div className="person-form-row">
            <label>
              Gender
              <div className="person-form-segmented" role="radiogroup" aria-label="Gender">
                {GENDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={form.gender === opt.value}
                    className={form.gender === opt.value ? 'active' : ''}
                    onClick={() => setField('gender', opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </label>
            <label>
              Date of birth (optional)
              <div className="person-form-date-field">
                <input type="date" value={form.dob} onChange={(e) => setField('dob', e.target.value)} />
                {form.dob && (
                  <button type="button" className="person-form-date-clear" aria-label="Clear date of birth" onClick={() => setField('dob', '')}>
                    <X size={14} />
                  </button>
                )}
              </div>
            </label>
          </div>

          <div className="person-form-row">
            {showMarriageDate && (
              <label>
                Marriage date (optional)
                <div className="person-form-date-field">
                  <input
                    type="date"
                    value={form.marriageDate}
                    onChange={(e) => setField('marriageDate', e.target.value)}
                  />
                  {form.marriageDate && (
                    <button type="button" className="person-form-date-clear" aria-label="Clear marriage date" onClick={() => setField('marriageDate', '')}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              </label>
            )}
            <label className="person-form-toggle">
              <input
                type="checkbox"
                checked={!form.isAlive}
                onChange={(e) => setField('isAlive', !e.target.checked)}
              />
              <span className="person-form-toggle-track"><span className="person-form-toggle-thumb" /></span>
              Deceased
            </label>
          </div>

          {!form.isAlive && (
            <div className="person-form-row">
              <label>
                Date of death (optional)
                {dodYearOnly ? (
                  <div className="person-form-date-field">
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="YYYY"
                      min="1000"
                      max="9999"
                      value={form.dod}
                      onChange={(e) => setField('dod', e.target.value.slice(0, 4))}
                    />
                    {form.dod && (
                      <button type="button" className="person-form-date-clear" aria-label="Clear date of death" onClick={() => setField('dod', '')}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="person-form-date-field">
                    <input type="date" value={form.dod} onChange={(e) => setField('dod', e.target.value)} />
                    {form.dod && (
                      <button type="button" className="person-form-date-clear" aria-label="Clear date of death" onClick={() => setField('dod', '')}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}
              </label>
              <label className="person-form-toggle">
                <input
                  type="checkbox"
                  checked={dodYearOnly}
                  onChange={(e) => {
                    const yearOnly = e.target.checked;
                    setDodYearOnly(yearOnly);
                    // A year alone can't become a full date, and a full date's
                    // exact day shouldn't survive switching to "year only" as if
                    // it were still known — clear rather than guess either way.
                    setField('dod', yearOnly ? (form.dod.slice(0, 4) || '') : '');
                  }}
                />
                <span className="person-form-toggle-track"><span className="person-form-toggle-thumb" /></span>
                Year only
              </label>
            </div>
          )}
        </div>

        <div className="person-form-section">
          <span className="person-form-section-title">Location (optional)</span>
          <label>
            <span className="person-form-visually-hidden">Location</span>
            <LocationInput
              value={form.location}
              lat={form.locationLat}
              lng={form.locationLng}
              approximate={form.locationApproximate}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            />
          </label>
        </div>

        <div className="person-form-section">
          <span className="person-form-section-title">Contact</span>
          <div className="person-form-row">
            <label>
              Work (optional)
              <input value={form.work} onChange={(e) => setField('work', e.target.value)} />
            </label>
            <label>
              Phone (optional)
              <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            </label>
          </div>
          <div className="person-form-row">
            <label>
              Email (optional)
              <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
            </label>
          </div>
        </div>

        <div className="person-form-section">
          <span className="person-form-section-title">About</span>
          <label>
            Notes / Bio (optional)
            <textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
          </label>
        </div>

        <div className="person-form-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="person-form-save">Save</button>
        </div>
        </>
        )}
      </form>
    </Modal>
  );
}
