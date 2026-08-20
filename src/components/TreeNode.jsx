import { motion, useReducedMotion } from 'framer-motion';
import { BadgeCheck, GitBranch, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NODE_W, NODE_H, COUPLE_GAP, AVATAR_SIZE } from '../hooks/useTreeLayout';
import { getDisplayName, getFullName, getInitials, isPrimaryOnLeft } from '../utils/familyUtils';

// Half of the empty space beside the avatar within a card, so the link can reach the circle's edge.
const CARD_SIDE_GAP = (NODE_W - AVATAR_SIZE) / 2;

const QUICK_ADD_OPTIONS = [
  // Covers both the first and second parent — dashed Add father/mother circles
  // are reserved for the auto-created "no linkage found" placeholder (see
  // TreeNode's isPlaceholder branch), not for every parentless real person.
  { mode: 'addParent', label: 'Add Parent', show: (p) => p.parentIds.length < 2 },
  { mode: 'addSpouse', label: 'Add Spouse', show: (p, hasSpouse) => !hasSpouse },
  { mode: 'addChild', label: 'Add Child', show: () => true },
  // Works even with no recorded parents yet — addSibling creates a clearly-
  // labeled "Unknown Parent" placeholder behind the scenes in that case.
  { mode: 'addSibling', label: 'Add Sibling', show: () => true },
];

function MiniCard({ person, isFocus, isHighlighted, isLocated, isMe, hasSpouse, showJumpLink, onFocus, onSelect, onQuickAdd, onJumpTo }) {
  const genderClass = `avatar avatar-${person.gender}`;
  const deceased = !person.isAlive;
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const avatarSpring = prefersReducedMotion
    ? {}
    : {
        whileHover: { y: -3, scale: 1.08 },
        whileTap: { scale: 0.94 },
        transition: { type: 'spring', stiffness: 320, damping: 18 },
      };

  // Closes the quick-add menu on any click outside this card, or on Escape —
  // matching the dismissal pattern the other dropdown menus in the app already
  // use (ImportExport's menu, MobileMenu), which this one had drifted from.
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const options = QUICK_ADD_OPTIONS.filter((opt) => opt.show(person, hasSpouse));

  return (
    <div
      className={`mini-card-wrap${isFocus ? ' mini-card-wrap-focus' : ''}${menuOpen ? ' mini-card-wrap-menu-open' : ''}`}
      ref={wrapRef}
    >
      <button
        type="button"
        className={`mini-card${deceased ? ' mini-card-deceased' : ''}${isFocus ? ' mini-card-focus' : ''}${isHighlighted ? ' mini-card-highlighted' : ''}${isLocated ? ' mini-card-located' : ''}`}
        style={{ width: NODE_W, height: NODE_H }}
        onClick={() => (isFocus ? onSelect(person.id) : onFocus(person.id))}
        title={getDisplayName(person)}
      >
        <motion.span className={`mini-card-avatar-wrap avatar-wrap-${person.gender}`} tabIndex={-1} {...avatarSpring}>
          <span className={genderClass}>
            {/* No crossOrigin here — person.photo is always a data: URI (see
                PersonForm's resizePhoto), never a real cross-origin fetch, and
                some WebKit/Safari versions fail to render a data: URI image
                entirely when crossorigin is set on it. */}
            {person.photo ? <img src={person.photo} alt="" /> : getInitials(person)}
          </span>
          {isMe && <BadgeCheck className="mini-card-me-badge" size={16} />}
        </motion.span>
        <span className="mini-name">
          {deceased && <span className="dagger">†</span>}
          {getFullName(person)}
        </span>
        {person.petName?.trim() && <span className="mini-pet-name">({person.petName.trim()})</span>}
      </button>

      {showJumpLink && (
        <button
          type="button"
          className="mini-card-jump"
          title="Has their own family tree — tap to open it"
          aria-label="Open this person's own family tree"
          onClick={(e) => {
            e.stopPropagation();
            onJumpTo(person.id);
          }}
        >
          <GitBranch size={12} strokeWidth={2.5} />
          <span>Their tree</span>
        </button>
      )}

      {options.length > 0 && (
        <div className="mini-card-add-anchor">
          <button
            type="button"
            className="mini-card-add"
            title="Add relative"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((open) => !open);
            }}
          >
            <Plus size={13} strokeWidth={2.5} />
          </button>

          {menuOpen && (
            <div className="mini-card-menu">
              {options.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onQuickAdd(person.id, opt.mode);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A positioned node holding a person (and optional spouse) plus an expand toggle.
export default function TreeNode({ node, index, focusId, side, highlightedIds, meId, locatedId, renderedIds, onFocus, onSelect, onToggle, onQuickAdd, onJumpTo }) {
  const { person, spouse, x, y, coupleWidth } = node;
  const left = x - coupleWidth / 2;
  const sideClass = side ? ` couple-side-${side}` : '';

  // Staggered fade/scale-in on mount (expand, root switch, edits) — capped so deep
  // trees don't get a sluggish cascading reveal; skipped for reduced-motion users.
  const prefersReducedMotion = useReducedMotion();
  const entrance = prefersReducedMotion
    ? { initial: false }
    : {
        initial: { opacity: 0, y: 8, scale: 0.96 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.28, delay: Math.min((index ?? 0) * 0.02, 0.3), ease: [0.4, 0, 0.2, 1] },
      };

  // A shared placeholder parent auto-created by "Add Sibling" (see useFamily's
  // addSibling) is never drawn as its own card — instead its row shows the same
  // "Add father"/"Add mother" boxes a true lineage root would, so filling either
  // one in edits this placeholder in place rather than adding a brand new person.
  if (person.isPlaceholder) {
    return (
      <motion.div className="tree-node" style={{ left, top: y, width: coupleWidth }} {...entrance}>
        <div className="couple parent-only-node">
          <button
            type="button"
            className="parent-placeholder"
            onClick={(e) => {
              e.stopPropagation();
              onQuickAdd(person.id, 'fillPlaceholderParent', 'father');
            }}
          >
            <span className="parent-placeholder-box">+</span>
            <span className="parent-placeholder-label">Add father</span>
          </button>
          <span className="parent-placeholder-bar" aria-hidden="true" />
          <button
            type="button"
            className="parent-placeholder"
            onClick={(e) => {
              e.stopPropagation();
              onQuickAdd(person.id, 'fillPlaceholderParent', 'mother');
            }}
          >
            <span className="parent-placeholder-box">+</span>
            <span className="parent-placeholder-label">Add mother</span>
          </button>
        </div>
      </motion.div>
    );
  }

  // App-wide rule: male renders left, female renders right — a fixed fact about
  // this couple's genders, independent of who's "primary" (the blood descendant the
  // layout recursed through, normally rendered first) vs. "spouse" (married in,
  // normally rendered second), and never affected by focus/selection so it can't
  // swap on click. See isPrimaryOnLeft — flips only the one combination that would
  // otherwise violate it.
  const primaryLeft = !spouse || isPrimaryOnLeft(person, spouse);
  const primaryCard = (
    <MiniCard
      key="primary"
      person={person}
      isFocus={person.id === focusId}
      isHighlighted={!!highlightedIds?.has(person.id)}
      isLocated={person.id === locatedId}
      isMe={!!meId && person.id === meId}
      hasSpouse={!!spouse}
      onFocus={onFocus}
      onSelect={onSelect}
      onQuickAdd={onQuickAdd}
      onJumpTo={onJumpTo}
    />
  );
  const spouseCard = spouse && (
    <MiniCard
      key="spouse"
      person={spouse}
      isFocus={spouse.id === focusId}
      isHighlighted={!!highlightedIds?.has(spouse.id)}
      isLocated={spouse.id === locatedId}
      isMe={!!meId && spouse.id === meId}
      hasSpouse
      // Anyone married in who has their own recorded parents has a family
      // tree of their own somewhere — the badge opens a dedicated Pedigree
      // View centred on them. But if that parent is already drawn on THIS
      // same canvas (e.g. Pedigree View renders both lineages in full), a
      // jump badge next to a line pointing at the very same person is just
      // redundant — suppress it in that case.
      showJumpLink={spouse.parentIds.length > 0 && !spouse.parentIds.some((pid) => renderedIds?.has(pid))}
      onFocus={onFocus}
      onSelect={onSelect}
      onQuickAdd={onQuickAdd}
      onJumpTo={onJumpTo}
    />
  );
  const coupleLink = spouse && (
    <span
      key="link"
      className="couple-link"
      style={{
        width: COUPLE_GAP + CARD_SIDE_GAP * 2,
        marginLeft: -CARD_SIDE_GAP,
        marginRight: -CARD_SIDE_GAP,
      }}
      aria-hidden="true"
    />
  );

  return (
    <motion.div className="tree-node" style={{ left, top: y, width: coupleWidth }} {...entrance}>
      <div className={`couple${sideClass}`}>
        {primaryLeft ? (
          <>
            {primaryCard}
            {coupleLink}
            {spouseCard}
          </>
        ) : (
          <>
            {spouseCard}
            {coupleLink}
            {primaryCard}
          </>
        )}
      </div>

      {node.hasChildren && (
        <button
          type="button"
          className="toggle-btn"
          onClick={() => onToggle(person.id)}
          title={node.collapsed ? 'Expand children' : 'Collapse children'}
        >
          {node.collapsed ? '+' : '\u2212'}
        </button>
      )}
    </motion.div>
  );
}
