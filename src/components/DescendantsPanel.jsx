import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getDisplayName, getInitials, getSpouse } from '../utils/familyUtils';
import Modal from './Modal';
import '../styles/DescendantsPanel.css';

// Builds the descendant forest under rootId as a nested { id, children } tree,
// placing each descendant under the first blood-parent reached so a cousin
// marriage inside the family can't render (or count) anyone twice.
function buildTree(persons, rootId) {
  const placed = new Set([rootId]);
  const build = (parentId) => {
    const p = persons[parentId];
    if (!p) return [];
    const nodes = [];
    for (const cid of p.childrenIds || []) {
      const c = persons[cid];
      if (!c || c.isPlaceholder || placed.has(cid)) continue;
      placed.add(cid);
      nodes.push({ id: cid, children: build(cid) });
    }
    return nodes;
  };
  return build(rootId);
}

// "children", "grandchildren", "great-grandchildren", "great-great-…".
const genName = (i) => (i === 0 ? 'children' : `${'great-'.repeat(i - 1)}grandchildren`);

function countByGeneration(tree) {
  const perGen = [];
  let level = tree;
  while (level.length) {
    perGen.push(level.length);
    level = level.flatMap((n) => n.children);
  }
  return perGen;
}

const subtreeCount = (node) => node.children.reduce((n, c) => n + 1 + subtreeCount(c), 0);

// Every node that HAS children (i.e. can be collapsed) — used by Collapse all.
function collapsibleIds(tree) {
  const ids = [];
  const walk = (nodes) => nodes.forEach((n) => {
    if (n.children.length) { ids.push(n.id); walk(n.children); }
  });
  walk(tree);
  return ids;
}

function DescNode({ persons, node, collapsed, onToggle, onSelect }) {
  const p = persons[node.id];
  if (!p) return null;
  const spouse = getSpouse(persons, p);
  const hasKids = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  return (
    <li>
      <div className="descendants-row">
        {hasKids ? (
          <button
            type="button"
            className="descendants-toggle"
            onClick={() => onToggle(node.id)}
            aria-label={isCollapsed ? 'Expand branch' : 'Collapse branch'}
          >
            {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          </button>
        ) : (
          <span className="descendants-toggle-spacer" />
        )}
        {/* A node WITH children toggles collapse on the whole row — the rows are
            small, so an accidental tap should never open a profile; only leaf
            nodes (nothing to collapse) open the person on tap. */}
        <button
          type="button"
          className="descendants-person"
          onClick={() => (hasKids ? onToggle(node.id) : onSelect(node.id))}
        >
          <span className={`avatar avatar-${p.gender} descendants-avatar`}>
            {p.photo ? <img src={p.photo} alt="" /> : getInitials(p)}
          </span>
          <span className="descendants-name">
            {p.isAlive === false && <span className="dagger">†</span>}
            {getDisplayName(p)}
          </span>
          {spouse && <span className="descendants-spouse">&amp; {getDisplayName(spouse)}</span>}
          {hasKids && isCollapsed && <span className="descendants-collapsed-count">{subtreeCount(node)}</span>}
        </button>
      </div>
      {hasKids && !isCollapsed && (
        <ul>
          {node.children.map((child) => (
            <DescNode key={child.id} persons={persons} node={child} collapsed={collapsed} onToggle={onToggle} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function DescendantsPanel({ persons, rootId, isOpen, onClose, onSelect }) {
  const root = rootId ? persons[rootId] : null;
  const tree = useMemo(() => (root ? buildTree(persons, rootId) : []), [persons, rootId, root]);
  const perGen = useMemo(() => countByGeneration(tree), [tree]);
  const total = perGen.reduce((n, c) => n + c, 0);
  const allCollapsible = useMemo(() => collapsibleIds(tree), [tree]);

  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allCollapsed = allCollapsible.length > 0 && allCollapsible.every((id) => collapsed.has(id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(allCollapsible));

  const go = (id) => {
    onSelect?.(id);
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Descendants" width="520px" className="descendants-panel">
      {root && (
        <>
          <h2>Descendants of {getDisplayName(root)}</h2>
          {total === 0 ? (
            <p className="descendants-empty">{getDisplayName(root)} has no descendants recorded.</p>
          ) : (
            <>
              <div className="descendants-toolbar">
                <p className="descendants-summary">
                  <strong>{total}</strong> {total === 1 ? 'descendant' : 'descendants'}
                  {perGen.length > 0 && (
                    <span className="descendants-gens">
                      {' — '}
                      {perGen.map((c, i) => `${c} ${genName(i)}`).join(' · ')}
                    </span>
                  )}
                </p>
                {allCollapsible.length > 0 && (
                  <button type="button" className="descendants-collapse-all" onClick={toggleAll}>
                    {allCollapsed ? 'Expand all' : 'Collapse all'}
                  </button>
                )}
              </div>
              <ul className="descendants-tree">
                {tree.map((node) => (
                  <DescNode key={node.id} persons={persons} node={node} collapsed={collapsed} onToggle={toggle} onSelect={go} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
