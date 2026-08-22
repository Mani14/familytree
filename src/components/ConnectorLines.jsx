import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NODE_H } from '../hooks/useTreeLayout';

function pathFor(links) {
  return links
    .map(({ fromX, fromY, toX, toY }) => {
      const midY = (fromY + toY) / 2;
      return `M ${fromX} ${fromY} V ${midY} H ${toX} V ${toY}`;
    })
    .join(' ');
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

  // Cross-family parentage lines (long, canvas-spanning) are drawn dotted so they
  // read as a secondary link rather than normal parentage — see useTreeLayout.
  const baseLinks = links.filter((l) => !l.isCrossLink);
  const crossLinks = links.filter((l) => l.isCrossLink);

  const d = pathFor(baseLinks);
  const crossD = crossLinks.length ? pathFor(crossLinks) : '';
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
      {crossD && (
        <path
          d={crossD}
          fill="none"
          stroke="var(--color-connector)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="1 8"
          opacity="0.75"
        />
      )}
      {settledD && <path key="settled" d={settledD} {...HIGHLIGHT_STROKE} />}
      {currentD && (
        <DrawnPath key={`current-${revealIndex}`} d={currentD} durationMs={transitionMs ?? 220} {...HIGHLIGHT_STROKE} />
      )}
      {fullD && <DrawnPath key="highlight" d={fullD} {...HIGHLIGHT_STROKE} />}
    </svg>
  );
}
