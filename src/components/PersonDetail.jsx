import { useEffect, useRef, useState } from 'react';
import { motion, Reorder, useDragControls } from 'framer-motion';
import { BadgeCheck, Baby, Briefcase, Cake, ChevronDown, ChevronUp, Eye, Gift, GitBranch, GripVertical, HeartHandshake, Mail, MapPin, Pencil, Phone, Route, Sparkles, Trash2, UserPlus, Users, X, XCircle } from 'lucide-react';
import {
  formatBirthdayNoYear,
  formatDateDisplay,
  getAgeInfo,
  getChildren,
  getDaysUntilBirthday,
  getFamilyStats,
  getFullName,
  getInitials,
  getParents,
  getRelationshipLabel,
  getRelationshipLabelTamil,
  getRelationshipSignature,
  getSiblings,
  getSpouse,
} from '../utils/familyUtils';
import { useBirthdayWishes } from '../hooks/useBirthdayWishes';
import '../styles/PersonDetail.css';

// One draggable row — a dedicated grip handle starts the drag (via Framer's
// dragControls) rather than the whole row, so a plain tap on the name still
// navigates and normal list scrolling isn't hijacked by an accidental touch
// anywhere else on the row. Framer's Reorder drag runs on pointer events, so
// unlike the old native-HTML5-drag implementation this works from touch too.
function ReorderableRow({ person, index, count, onNavigate, onUnlink, onReorder, onDragEnd }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={person.id}
      as="span"
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      className="detail-link-row"
      whileDrag={{ scale: 1.04, boxShadow: '0 4px 14px rgba(0,0,0,.25)', zIndex: 1 }}
    >
      <span
        className="detail-drag-handle"
        title="Drag to reorder"
        onPointerDown={(e) => controls.start(e)}
      >
        <GripVertical size={13} />
      </span>
      <span className="detail-reorder">
        <button
          type="button"
          className="detail-reorder-btn"
          disabled={index === 0}
          title={`Move ${getFullName(person)} earlier`}
          onClick={() => onReorder(person.id, 'up')}
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          className="detail-reorder-btn"
          disabled={index === count - 1}
          title={`Move ${getFullName(person)} later`}
          onClick={() => onReorder(person.id, 'down')}
        >
          <ChevronDown size={12} />
        </button>
      </span>
      <button type="button" className="detail-link" onClick={() => onNavigate(person.id)}>
        {getFullName(person)}
      </button>
      {onUnlink && (
        <button
          type="button"
          className="detail-unlink"
          title={`Remove ${getFullName(person)}`}
          onClick={() => onUnlink(person.id)}
        >
          ×
        </button>
      )}
    </Reorder.Item>
  );
}

// `onReorder` (Children only — order is meaningless for Spouse/Parents/Siblings)
// moves a child earlier/later among ITS OWN siblings, kept in sync across every
// one of the child's recorded parents (see useFamily's reorderChild) — the only
// way to capture birth order when exact DOB isn't known.
function RelationList({ title, people, onNavigate, onUnlink, onReorder }) {
  // Local visual order, live-updated by Reorder.Group as items cross each
  // other mid-drag — kept separate from `people` (the actual Firestore-backed
  // data) so a whole drag still becomes exactly ONE reorderChild call/undo-
  // history entry on drop, not one per slot crossed (see reorderChild's own
  // comment for why that matters). Re-synced from `people` whenever a drag
  // ISN'T in progress, so edits made elsewhere (or the just-committed reorder
  // itself) don't leave this stale.
  const [orderIds, setOrderIds] = useState(() => people.map((p) => p.id));
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setOrderIds(people.map((p) => p.id));
  }, [people]);

  if (people.length === 0) return null;

  const byId = new Map(people.map((p) => [p.id, p]));
  const orderedPeople = orderIds.map((id) => byId.get(id)).filter(Boolean);

  const commitReorder = (draggedId) => {
    draggingRef.current = false;
    const oldIndex = people.findIndex((p) => p.id === draggedId);
    const newIndex = orderIds.indexOf(draggedId);
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const steps = newIndex - oldIndex;
      onReorder(draggedId, steps > 0 ? 'down' : 'up', Math.abs(steps));
    }
  };

  return (
    <div className="detail-relation">
      <span className="detail-relation-title">
        {title}
        {onReorder && people.length > 1 && (
          <span className="detail-relation-hint">— drag, or use ▲▼, to reorder</span>
        )}
      </span>
      {onReorder ? (
        <Reorder.Group
          as="div"
          axis="y"
          className="detail-relation-links detail-relation-links-reorderable"
          values={orderIds}
          onReorder={(ids) => { draggingRef.current = true; setOrderIds(ids); }}
        >
          {orderedPeople.map((p, index) => (
            <ReorderableRow
              key={p.id}
              person={p}
              index={index}
              count={orderedPeople.length}
              onNavigate={onNavigate}
              onUnlink={onUnlink}
              onReorder={onReorder}
              onDragEnd={() => commitReorder(p.id)}
            />
          ))}
        </Reorder.Group>
      ) : (
        <div className="detail-relation-links">
          {people.map((p) => (
            <span key={p.id} className="detail-link-row">
              <button type="button" className="detail-link" onClick={() => onNavigate(p.id)}>
                {getFullName(p)}
              </button>
              {onUnlink && (
                <button
                  type="button"
                  className="detail-unlink"
                  title={`Remove ${getFullName(p)}`}
                  onClick={() => onUnlink(p.id)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PersonDetail({
  person,
  persons,
  isRoot,
  anchorId,
  anchorContext,
  isHighlighted,
  meId,
  onSetMe,
  user,
  isAdmin,
  showAges = true,
  onClose,
  onNavigate,
  onEdit,
  onAddChild,
  onAddSpouse,
  onAddParent,
  onAddSibling,
  onDelete,
  onSetRoot,
  onViewTree,
  onUnlinkSpouse,
  onUnlinkParent,
  onUnlinkChild,
  onReorderChild,
  onHighlightLineage,
  onClearHighlight,
  onFindConnection,
  overrides = [],
  onEditRelationship,
}) {
  // Called unconditionally, before the `!person` early return below — person
  // can transiently be undefined while this panel is still mid-exit-animation
  // (AnimatePresence keeps it mounted briefly after `selected` clears), and a
  // hook called only on SOME renders breaks React's hook-order rule.
  const { wishes, addWish, removeWish } = useBirthdayWishes(person?.id, user);
  const [wishText, setWishText] = useState('');

  if (!person) return null;

  const spouse = getSpouse(persons, person);
  const parents = getParents(persons, person);
  const children = getChildren(persons, person);
  const siblings = getSiblings(persons, person);
  const ageInfo = showAges ? getAgeInfo(person) : null;
  const baseRelationship = anchorId ? getRelationshipLabel(persons, person.id, anchorId) : null;
  const tamilRelationship = anchorId ? getRelationshipLabelTamil(persons, person.id, anchorId, overrides) : null;
  // null whenever the relationship isn't customizable at all (e.g. person IS
  // anchor's spouse — கணவர்/மனைவி is unambiguous already) — gates the pencil
  // affordance below independently of relationshipLabel's own (English-only)
  // truthiness check.
  const relationshipSignature = anchorId ? getRelationshipSignature(persons, person.id, anchorId) : null;
  // English isn't required — some relationship shapes (a chained-in-law's
  // own further-removed relatives) only have a clean word in Tamil; showing
  // a manufactured, nested English phrase for those ("Cousin-in-law's Spouse
  // (in-law)") reads worse than just omitting English for that one badge.
  const relationshipLabel = tamilRelationship || baseRelationship
    ? `${tamilRelationship ? `${tamilRelationship}${baseRelationship ? ' · ' : ''}` : ''}${baseRelationship ? `${baseRelationship} ` : ''}(to ${anchorContext})`
    : null;
  const daysUntilBirthday = person.isAlive ? getDaysUntilBirthday(person.dob) : null;
  const stats = getFamilyStats(persons, person);
  const hasStats = stats && (stats.childrenCount > 0 || stats.grandchildrenCount > 0 || stats.siblingsCount > 0);
  const isMe = !!meId && meId === person.id;

  const handleSendWish = (e) => {
    e.preventDefault();
    if (!wishText.trim()) return;
    addWish(wishText);
    setWishText('');
  };

  return (
    <motion.aside
      className="person-detail glass-surface"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="detail-header">
        <button type="button" className="detail-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <span className={`avatar avatar-${person.gender} detail-avatar`}>
          {person.photo ? <img src={person.photo} alt="" /> : getInitials(person)}
        </span>
        <div>
          <div className="detail-name-row">
            <h2 className="detail-name">
              {!person.isAlive && <span className="dagger">†</span>}
              {getFullName(person)}
              {person.petName?.trim() && <span className="detail-pet-name">({person.petName.trim()})</span>}
            </h2>
            <button type="button" className="detail-edit-btn" onClick={onEdit} title="Edit" aria-label="Edit">
              <Pencil size={13} />
            </button>
          </div>
          {!person.isAlive && <span className="detail-badge">Passed Away</span>}
          {relationshipLabel && (
            <span className="detail-badge detail-badge-relation">
              {relationshipLabel}
              {relationshipSignature && onEditRelationship && (
                <button
                  type="button"
                  className="detail-relation-edit-btn"
                  onClick={() => onEditRelationship(person.id, anchorId, relationshipSignature, tamilRelationship, baseRelationship)}
                  title="Correct this Tamil term — applies everywhere this same relationship shape occurs"
                  aria-label="Edit relationship term"
                >
                  <Pencil size={10} />
                </button>
              )}
            </span>
          )}
          {ageInfo && (
            <span className="detail-age">
              {ageInfo.label}: {ageInfo.value}
            </span>
          )}
        </div>
      </div>

      <div className="detail-fields">
        {person.dob && (
          <div className="detail-field">
            <Cake size={14} /> {showAges ? formatDateDisplay(person.dob) : formatBirthdayNoYear(person.dob)}
            {daysUntilBirthday != null && (
              <span className="detail-field-muted">
                · {daysUntilBirthday === 0 ? 'today!' : `in ${daysUntilBirthday} day${daysUntilBirthday === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
        )}
        {!person.isAlive && person.dod && <div className="detail-field">🕊️ {formatDateDisplay(person.dod)}</div>}
        {person.work && <div className="detail-field"><Briefcase size={14} /> {person.work}</div>}
        {person.location && (
          <div className="detail-field">
            <MapPin size={14} />
            {/* Coordinates (when geocoded — see LocationInput) point Maps at the
                exact pin; plain-text locations saved before that existed, or
                typed without picking a suggestion, fall back to a text search. */}
            <a
              className="detail-field-link"
              href={
                person.locationLat != null && person.locationLng != null
                  ? `https://www.google.com/maps/search/?api=1&query=${person.locationLat},${person.locationLng}`
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(person.location)}`
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              {person.location}
            </a>
            {/* Stamped by LocationInput when the GPS fix that set this pin was
                clearly approximate (not just weak GPS) — visible here to
                whoever views the profile later, not just a one-time toast to
                whoever entered it. */}
            {person.locationApproximate && (
              <span className="detail-field-warning" title="This location was set from an approximate (non-precise) GPS fix">
                ~approximate
              </span>
            )}
          </div>
        )}
        {person.phone && <div className="detail-field"><Phone size={14} /> {person.phone}</div>}
        {person.email && <div className="detail-field"><Mail size={14} /> {person.email}</div>}
      </div>

      {hasStats && (
        <div className="detail-stats">
          {stats.childrenCount > 0 && (
            <span className="detail-stat">
              <strong>{stats.childrenCount}</strong> Child{stats.childrenCount === 1 ? '' : 'ren'}
            </span>
          )}
          {stats.grandchildrenCount > 0 && (
            <span className="detail-stat">
              <strong>{stats.grandchildrenCount}</strong> Grandchild{stats.grandchildrenCount === 1 ? '' : 'ren'}
            </span>
          )}
          {stats.siblingsCount > 0 && (
            <span className="detail-stat">
              <strong>{stats.siblingsCount}</strong> Sibling{stats.siblingsCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {person.notes && (
        <div className="detail-notes">
          <span className="detail-relation-title">Notes</span>
          <p>{person.notes}</p>
        </div>
      )}

      <div className="detail-wishes">
        <span className="detail-relation-title detail-wishes-title"><Gift size={13} /> Birthday Wishes</span>
        {wishes.length > 0 && (
          <ul className="detail-wishes-list">
            {wishes.map((wish) => (
              <li key={wish.id}>
                <div className="detail-wish-body">
                  <span className="detail-wish-from">{wish.fromName}</span>
                  <p className="detail-wish-message">{wish.message}</p>
                </div>
                {user && (wish.fromUid === user.uid || isAdmin) && (
                  <button
                    type="button"
                    className="detail-wish-remove"
                    title="Remove this wish"
                    aria-label="Remove this wish"
                    onClick={() => removeWish(wish.id)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {user ? (
          <form className="detail-wish-form" onSubmit={handleSendWish}>
            <textarea
              value={wishText}
              onChange={(e) => setWishText(e.target.value)}
              placeholder={`Leave a birthday wish for ${person.firstName}…`}
              rows={2}
            />
            <button type="submit" disabled={!wishText.trim()}>Send Wish</button>
          </form>
        ) : (
          wishes.length === 0 && <p className="detail-muted">No wishes yet.</p>
        )}
      </div>

      <div className="detail-relations">
        <RelationList
          title={spouse ? `Spouse${person.marriageDate ? ` (m. ${formatDateDisplay(person.marriageDate)})` : ''}` : ''}
          people={spouse ? [spouse] : []}
          onNavigate={onNavigate}
          onUnlink={onUnlinkSpouse}
        />
        <RelationList title="Parents" people={parents} onNavigate={onNavigate} onUnlink={onUnlinkParent} />
        <RelationList
          title="Children"
          people={children}
          onNavigate={onNavigate}
          onUnlink={onUnlinkChild}
          onReorder={onReorderChild}
        />
        <RelationList title="Siblings" people={siblings} onNavigate={onNavigate} />
      </div>

      <div className="detail-actions">
        <button type="button" onClick={onEdit}><Pencil size={14} /> Edit</button>
        <button type="button" onClick={onAddChild}><Baby size={14} /> Add Child</button>
        {!spouse && (
          <button type="button" onClick={onAddSpouse}><HeartHandshake size={14} /> Add Spouse</button>
        )}
        {parents.length < 2 && (
          <button type="button" onClick={onAddParent}><UserPlus size={14} /> Add Parent</button>
        )}
        {onAddSibling && (
          <button type="button" onClick={onAddSibling}><Users size={14} /> Add Sibling</button>
        )}
        {onViewTree && (
          <button type="button" onClick={() => onViewTree(person.id)}><GitBranch size={14} /> View Tree</button>
        )}
        {!isRoot && (
          <button type="button" onClick={onSetRoot} title="Makes this your own starting view when you open the tree — doesn't change anyone else's view">
            <Eye size={14} /> View as this person
          </button>
        )}
        {isHighlighted ? (
          <button type="button" onClick={onClearHighlight}><XCircle size={14} /> Clear Highlight</button>
        ) : (
          <button type="button" onClick={() => onHighlightLineage(person.id)}><Sparkles size={14} /> Highlight Lineage</button>
        )}
        {onFindConnection && (
          <button type="button" onClick={() => onFindConnection(person.id)}><Route size={14} /> Find Connection</button>
        )}
        {onSetMe && (
          <button
            type="button"
            className={isMe ? 'detail-action-active' : ''}
            onClick={() => onSetMe(isMe ? null : person.id)}
          >
            <BadgeCheck size={14} /> {isMe ? 'This is You ✓' : 'Mark as Me'}
          </button>
        )}
        <button type="button" className="detail-delete" onClick={onDelete}><Trash2 size={14} /> Delete</button>
      </div>
    </motion.aside>
  );
}
