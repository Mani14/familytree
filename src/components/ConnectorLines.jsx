import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NODE_H } from '../hooks/useTreeLayout';

// `midOffset` nudges only the horizontal run (not the verticals) down a few px,
// so a coloured overlap line sits just below the grey line instead of hiding it.
function pathFor(links, midOffset = 0) {
  return links
    .map(({ fromX, fromY, toX, toY }) => {
      const midY = (fromY + toY) / 2 + midOffset;
      return `M ${fromX} ${fromY} V ${midY} H ${toX} V ${toY}`;
    })
    .join(' ');
}

// Classifies which whole connector lines to recolour where they run ON TOP OF a
// line from a DIFFERENT parent (collinear + overlapping) — not the horizontal
// "bus" a single parent's own children intentionally share, and not perpendicular
// T-junctions (which meet at a point). For each overlapping pair the LONGER link
// is kept (the line running ACROSS, e.g. a cross-family parentage line), so it
// lights up rather than the short segment it lies along. A kept line is `purple`
// if any of its segments passes through a spot where 3+ DIFFERENT parents pile up
// (a "double overlap"), otherwise `amber`. Both are returned as whole links, to
// be redrawn end-to-end.
function classifyOverlaps(links) {
  const horiz = []; // { c: y, a: xMin, b: xMax, p: parentId, idx }
  const vert = []; //  { c: x, a: yMin, b: yMax, p: parentId, idx }
  links.forEach((l, idx) => {
    const midY = (l.fromY + l.toY) / 2;
    if (l.fromY !== midY) vert.push({ c: l.fromX, a: Math.min(l.fromY, midY), b: Math.max(l.fromY, midY), p: l.parentId, idx });
    if (l.fromX !== l.toX) horiz.push({ c: midY, a: Math.min(l.fromX, l.toX), b: Math.max(l.fromX, l.toX), p: l.parentId, idx });
    if (midY !== l.toY) vert.push({ c: l.toX, a: Math.min(midY, l.toY), b: Math.max(midY, l.toY), p: l.parentId, idx });
  });

  const MIN = 1; // ignore sub-pixel touches
  const winners = new Set(); // link idx kept by the longer-wins rule above
  const deep = { h: new Map(), v: new Map() }; // rounded coord -> merged [lo,hi] where 3+ parents pile up

  const process = (segs, kind) => {
    const byLine = new Map(); // collinear segments share a rounded constant coord
    for (const s of segs) {
      const arr = byLine.get(Math.round(s.c));
      if (arr) arr.push(s);
      else byLine.set(Math.round(s.c), [s]);
    }
    for (const [key, group] of byLine) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const A = group[i];
          const B = group[j];
          if (A.p === B.p) continue; // same parent's own bus — intentional
          if (Math.min(A.b, B.b) - Math.max(A.a, B.a) <= MIN) continue;
          if (A.b - A.a >= B.b - B.a) winners.add(A.idx);
          if (B.b - B.a >= A.b - A.a) winners.add(B.idx);
        }
      }
      if (group.length < 3) continue; // a 3+ pile-up needs at least 3 segments
      const bounds = [...new Set(group.flatMap((s) => [s.a, s.b]))].sort((m, n) => m - n);
      const spans = [];
      for (let i = 0; i < bounds.length - 1; i += 1) {
        const lo = bounds[i];
        const hi = bounds[i + 1];
        if (hi - lo <= MIN) continue;
        const mid = (lo + hi) / 2;
        const parents = new Set();
        for (const s of group) if (s.a <= mid && mid <= s.b) parents.add(s.p);
        if (parents.size >= 3) spans.push([lo, hi]);
      }
      if (!spans.length) continue;
      const merged = [spans[0].slice()];
      for (let k = 1; k < spans.length; k += 1) {
        const last = merged[merged.length - 1];
        if (spans[k][0] <= last[1] + 0.5) last[1] = Math.max(last[1], spans[k][1]);
        else merged.push(spans[k].slice());
      }
      (kind === 'h' ? deep.h : deep.v).set(key, merged);
    }
  };

  process(horiz, 'h');
  process(vert, 'v');

  // For each 3+ pile-up stretch, the LONGEST line passing through it is the
  // "double overlap" line — coloured purple along its WHOLE path (start to finish).
  // Every other kept overlap line stays amber. Both are drawn end-to-end.
  const purpleIdx = new Set();
  const claimDeep = (kind, key, lo, hi) => {
    let bestIdx = -1;
    let bestLen = -1;
    links.forEach((l, idx) => {
      const midY = (l.fromY + l.toY) / 2;
      let segLo;
      let segHi;
      if (kind === 'h') {
        if (Math.round(midY) !== key || l.fromX === l.toX) return;
        segLo = Math.min(l.fromX, l.toX);
        segHi = Math.max(l.fromX, l.toX);
      } else if (Math.round(l.fromX) === key && l.fromY !== midY) {
        segLo = Math.min(l.fromY, midY);
        segHi = Math.max(l.fromY, midY);
      } else if (Math.round(l.toX) === key && midY !== l.toY) {
        segLo = Math.min(midY, l.toY);
        segHi = Math.max(midY, l.toY);
      } else {
        return;
      }
      if (Math.min(segHi, hi) - Math.max(segLo, lo) <= MIN) return; // must span the pile-up
      const len = Math.abs(l.toX - l.fromX) + Math.abs(l.toY - l.fromY);
      if (len > bestLen) {
        bestLen = len;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) purpleIdx.add(bestIdx);
  };
  for (const [key, spans] of deep.h) for (const [lo, hi] of spans) claimDeep('h', key, lo, hi);
  for (const [key, spans] of deep.v) for (const [lo, hi] of spans) claimDeep('v', key, lo, hi);

  const amberLinks = [...winners].filter((i) => !purpleIdx.has(i)).map((i) => links[i]);
  const purpleLinks = [...purpleIdx].map((i) => links[i]);
  return { amberLinks, purpleLinks };
}

// A constant "drawing speed" (px of path per ms) so a short highlighted hop
// draws quickly and a long cross-tree one takes longer, instead of every path
// taking the same fixed time regardless of how far it actually runs. Only used
// for the one-shot (non-travel) reveal — the travel case is given an explicit
// durationMs instead, so the line stays in lockstep with the camera/car.
const DRAW_SPEED_PX_PER_MS = 0.9;
const MIN_DRAW_MS = 500;
const MAX_DRAW_MS = 2800;

// Renders `d` with a "drawing" reveal (stroke-dashoffset animating to 0) instead
// of appearing instantly. Re-measures and restarts whenever `d` itself changes —
// each call site is expected to hand this a STABLE, unchanging `d` for the
// duration of one reveal (see ConnectorLines below for how the travel case keeps
// prior segments in a separate, non-animated path so they don't replay).
function DrawnPath({ d, durationMs, ...pathProps }) {
  const ref = useRef(null);
  const [length, setLength] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useLayoutEffect(() => {
    setRevealed(false);
    setLength(ref.current ? ref.current.getTotalLength() : 0);
  }, [d]);

  useEffect(() => {
    if (!length) return undefined;
    const raf = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(raf);
  }, [length, d]);

  const duration = durationMs ?? Math.min(MAX_DRAW_MS, Math.max(MIN_DRAW_MS, length / DRAW_SPEED_PX_PER_MS));

  return (
    <path
      ref={ref}
      d={d}
      style={{
        strokeDasharray: length || undefined,
        strokeDashoffset: length ? (revealed ? 0 : length) : undefined,
        transition: length ? `stroke-dashoffset ${duration}ms linear` : 'none',
      }}
      {...pathProps}
    />
  );
}

const HIGHLIGHT_STROKE = {
  fill: 'none',
  stroke: 'var(--color-highlight)',
  strokeWidth: 4,
  strokeLinecap: 'round',
};

// Draws orthogonal parent-to-child connectors as a single SVG path. When
// `highlightedLinks` (an ordered array of link objects, in chain-traversal order)
// is given, those links are additionally drawn a second time, on top, in the
// highlight colour.
//
// `revealIndex` (from FamilyTree, driven by where locatedId sits in the chain)
// says how many hops of the chain the "travel" has reached: segments before it
// are already-settled ground (drawn instantly, no re-animation), the segment
// AT it is the one currently being crossed (drawn with a reveal timed to
// `transitionMs`, matching the camera/car's own glide), and segments after it
// aren't drawn yet at all. -1 means there's no travel in progress (e.g. plain
// "Highlight Lineage") — in that case the whole path reveals at once instead.
export default function ConnectorLines({ links, width, height, highlightedLinks, revealIndex = -1, transitionMs }) {
  if (!links.length) return null;

  const { amberLinks, purpleLinks } = classifyOverlaps(links);
  // A coloured line is drawn with its horizontal run offset just below the grey
  // one; skipping those links in the grey base path avoids leaving a stray grey
  // line directly above the coloured one.
  const colored = new Set([...amberLinks, ...purpleLinks]);
  const d = pathFor(links.filter((l) => !colored.has(l)));
  const overlapD = pathFor(amberLinks, 8);
  const deepOverlapD = pathFor(purpleLinks, 8);
  const traveling = revealIndex >= 0 && highlightedLinks?.length > 0;
  // Entries can be `null` — a segment that lived in a view we've since jumped away
  // from (see FamilyTree's highlightedLinks) — filtered out here since there's
  // nothing to draw for it on THIS canvas, without disturbing the indices anyone
  // else (revealIndex, the travel car) relies on.
  const settledLinks = traveling ? highlightedLinks.slice(0, Math.max(revealIndex - 1, 0)).filter(Boolean) : [];
  const currentLink = traveling ? highlightedLinks[revealIndex - 1] : null;
  const settledD = settledLinks.length ? pathFor(settledLinks) : '';
  const currentD = currentLink ? pathFor([currentLink]) : '';
  const fullD = !traveling && highlightedLinks?.length ? pathFor(highlightedLinks.filter(Boolean)) : '';

  return (
    <svg
      className="connector-svg"
      width={Math.max(width, 1)}
      height={Math.max(height + NODE_H, 1)}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
    >
      <path d={d} fill="none" stroke="var(--color-connector)" strokeWidth="2.5" strokeLinecap="round" />
      {overlapD && <path d={overlapD} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />}
      {deepOverlapD && <path d={deepOverlapD} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" />}
      {settledD && <path key="settled" d={settledD} {...HIGHLIGHT_STROKE} />}
      {currentD && (
        <DrawnPath key={`current-${revealIndex}`} d={currentD} durationMs={transitionMs ?? 220} {...HIGHLIGHT_STROKE} />
      )}
      {fullD && <DrawnPath key="highlight" d={fullD} {...HIGHLIGHT_STROKE} />}
    </svg>
  );
}
