import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { NODE_H, NODE_W, COUPLE_GAP, AVATAR_TOP, AVATAR_SIZE, useForestLayout, usePedigreeLayout } from '../hooks/useTreeLayout';
import { findRootBridges, getForestRoots, getLineageRootIds, getPerson, getRelationshipLabel, isPrimaryOnLeft } from '../utils/familyUtils';
import ConnectorLines from './ConnectorLines';
import MiniMap from './MiniMap';
import TreeNode from './TreeNode';
import '../styles/FamilyTree.css';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

// `.tree-world` has no intrinsic size of its own (all its children are absolutely
// positioned) and normally sits pan/zoom-transformed inside a clipped, viewport-sized
// `.tree-canvas` — capturing it directly would only grab whatever's currently
// scrolled into view. This resets the transform to identity for the capture so
// html2canvas renders the whole tree at natural scale, then restores it after.
async function captureFullTree(html2canvas, worldEl, backgroundColor) {
  const prevTransform = worldEl.style.transform;
  const prevTransition = worldEl.style.transition;
  worldEl.style.transition = 'none';
  worldEl.style.transform = 'none';
  try {
    return await html2canvas(worldEl, { backgroundColor, useCORS: true });
  } finally {
    worldEl.style.transform = prevTransform;
    worldEl.style.transition = prevTransition;
  }
}

// Shares a file via the native Share Sheet when available — the reliable way to save
// on iOS Safari, which doesn't support the anchor `download` attribute for data/blob
// URLs — falling back to an in-DOM anchor-click download (desktop browsers) otherwise.
async function shareOrDownloadFile(blob, filename, mimeType) {
  const file = new File([blob], filename, { type: mimeType });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      // Sharing failed for another reason — fall through to the download link below.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari (desktop and iOS) ignores the `download` attribute for blob URLs and
  // silently does nothing instead of downloading — open the file in a new tab so the
  // user can save it manually (long-press > Save Image, or the PDF viewer's own
  // share/save button).
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// A node's `.x` is the COUPLE's shared centre (see useTreeLayout's place()), not
// either individual's own avatar — offset to whichever half `targetId` actually is
// (primary renders left, spouse renders right; see TreeNode) so a specific person's
// own circle can be centred exactly, not the midpoint between them and their spouse.
function individualX(node, targetId) {
  if (!node.spouse) return node.x;
  // Same male-left/female-right check as TreeNode's own render order and the
  // connector-line offsets — which side targetId's own avatar sits on depends on
  // gender, not simply on whether they're the primary or spouse role in this node.
  const primaryLeft = isPrimaryOnLeft(node.person, node.spouse);
  const targetIsSpouse = node.spouse.id === targetId && node.person.id !== targetId;
  const targetOnLeft = targetIsSpouse ? !primaryLeft : primaryLeft;
  const HALF_COUPLE_OFFSET = (NODE_W + COUPLE_GAP) / 2;
  return node.x + (targetOnLeft ? -HALF_COUPLE_OFFSET : HALF_COUPLE_OFFSET);
}

// A connector link is drawn as an elbow — drop, then sideways, then drop again
// (see ConnectorLines' pathFor: `M fromX fromY V midY H toX V toY`) — so a point
// "t" of the way along it isn't a straight-line lerp between the endpoints; it has
// to walk the same three legs in proportion to their own length, which is what
// makes the travel car actually turn corners with the line instead of cutting
// diagonally through whatever card happens to sit between the two nodes.
//
// The line's own fromY/toY terminate at the AVATAR's edges (see useTreeLayout's
// AVATAR_TOP/AVATAR_SIZE offsets), but the camera centres each card on its whole
// box — node.y + NODE_H/2 (see centerTree and the locate effect below). So the
// car's vertical legs are stretched a little past the line's own start/end to
// reach each card's true centre — but the HORIZONTAL leg stays at the line's own
// midY, unstretched, or the car would ride to the side of the visible track
// instead of on it during that leg.
// `angle` is the heading in degrees for a top-down car icon that points "up" (0deg)
// at rest — 180 driving down, 90/-90 driving right/left — so the travel car visibly
// turns at each leg boundary instead of staying fixed in one orientation.
function pointAlongLink({ fromX, fromY, toX, toY }, t) {
  const midY = (fromY + toY) / 2;
  const carFromY = fromY - (AVATAR_TOP + AVATAR_SIZE - NODE_H / 2);
  const carToY = toY + (NODE_H / 2 - AVATAR_TOP);
  const legDown1 = Math.abs(midY - carFromY);
  const legAcross = Math.abs(toX - fromX);
  const legDown2 = Math.abs(carToY - midY);
  const total = legDown1 + legAcross + legDown2;
  if (total === 0) return { x: fromX, y: carFromY, angle: 0 };
  const dist = Math.max(0, Math.min(1, t)) * total;
  if (dist <= legDown1) {
    const f = legDown1 === 0 ? 0 : dist / legDown1;
    return { x: fromX, y: carFromY + (midY - carFromY) * f, angle: midY >= carFromY ? 180 : 0 };
  }
  if (dist <= legDown1 + legAcross) {
    const f = legAcross === 0 ? 0 : (dist - legDown1) / legAcross;
    return { x: fromX + (toX - fromX) * f, y: midY, angle: toX >= fromX ? 90 : -90 };
  }
  const f = legDown2 === 0 ? 0 : (dist - legDown1 - legAcross) / legDown2;
  return { x: toX, y: midY + (carToY - midY) * f, angle: carToY >= midY ? 180 : 0 };
}

// Renders either every family in the dataset side by side (mode="forest", not just
// the one connected to the focus person) or one person's ancestors-above +
// descendants-below "hourglass" (mode="pedigree"), with `rootId` as the focus.
// `priorityId` anchors which lineage wins ownership of a shared descendant (e.g.
// Kesavamoorthy/Vanaja) — it defaults to `rootId` but should normally be given the
// PERSISTED root person (App.jsx's effectiveRootId — your own personal default,
// not the shared family data), not the transient focus. Ownership
// needs to stay stable as you click around the tree; keying it to whoever you're
// currently looking at would let ownership flip mid-session — e.g. clicking someone
// whose lineage traces to a tiny satellite cluster would shove that cluster to the
// front of the claim order, stealing a shared branch away from the real family and
// making it vanish entirely once that tiny cluster gets excluded as a satellite.
const FamilyTree = forwardRef(function FamilyTree(
  { persons, rootId, priorityId, collapsed, mode = 'forest', highlightedIds, locateId, locateNonce, locatedId, meId, travelTransitionMs, isTraveling, onFocus, onSelect, onToggle, onQuickAdd, onJumpTo, onLocateNotFound },
  exportRef
) {
  const rootIds = useMemo(
    () => getForestRoots(persons, priorityId ?? rootId),
    [persons, priorityId, rootId]
  );
  const forestLayout = useForestLayout(persons, rootIds, collapsed, priorityId ?? rootId);
  const pedigreeLayout = usePedigreeLayout(persons, rootId, collapsed);
  const layout = mode === 'pedigree' ? pedigreeLayout : forestLayout;

  // Every person/spouse id actually drawn on THIS canvas right now — used to
  // suppress a spouse's jump-link badge when their own parent (what the jump
  // would take you to) is already visible here, making the jump redundant.
  const renderedIds = useMemo(
    () => new Set(layout.nodes.flatMap((n) => (n.spouse ? [n.id, n.spouse.id] : [n.id]))),
    [layout]
  );

  // Built by walking the chain IN ORDER (not by filtering layout.links, which has
  // no notion of sequence) so ConnectorLines can draw the highlight progressively,
  // segment by segment, in the same order the chain itself runs — a couple's
  // connector is anchored to whichever spouse the layout used as its placement id,
  // so each hop also checks the chain member's spouse, not just an exact id match.
  // A segment that ISN'T drawn in the CURRENT layout (e.g. right after a mid-travel
  // jump, when most of the path lived in the view we just left) pushes `null`
  // rather than being skipped — the array's length must always match chain.length-1
  // so index i keeps meaning "chain[i] -> chain[i+1]" everywhere else that indexes
  // into it (revealIndex in ConnectorLines, locatedChainIndex for the travel car).
  const highlightedLinks = useMemo(() => {
    if (!highlightedIds?.size) return [];
    const chain = [...highlightedIds];
    const linkByPair = new Map();
    layout.links.forEach((l) => {
      if (l.parentId && l.childId) linkByPair.set(`${l.parentId}|${l.childId}`, l);
    });
    const lookup = (a, b) => linkByPair.get(`${a}|${b}`) || linkByPair.get(`${b}|${a}`);
    const result = [];
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = chain[i];
      const b = chain[i + 1];
      const aSpouse = persons[a]?.spouseId;
      const bSpouse = persons[b]?.spouseId;
      const link =
        lookup(a, b) ||
        (aSpouse && lookup(aSpouse, b)) ||
        (bSpouse && lookup(a, bSpouse));
      if (!link) {
        result.push(null);
        continue;
      }
      // A link's own fromX/fromY is always its PARENT's position (drawn above),
      // regardless of which way the chain actually walks through it — reorient so
      // fromX/fromY match `a` (where the travel currently is) and toX/toY match
      // `b` (where it's headed). Without this, any leg of the path that climbs
      // UP from a child to a parent — e.g. Ilan up to his father Velmurugan —
      // has the travel car start at the parent's end and drive backwards.
      const aIsParentEnd = link.parentId === a || persons[link.parentId]?.spouseId === a;
      result.push(
        aIsParentEnd ? link : { ...link, fromX: link.toX, fromY: link.toY, toX: link.fromX, toY: link.fromY }
      );
    }
    return result;
  }, [layout.links, highlightedIds, persons]);

  // Where the highlight has "reached" so far — drives both the progressive line
  // reveal and the travel car below. -1 means locatedId isn't on the highlighted
  // chain at all (e.g. Highlight Lineage, which never calls Locate), in which case
  // ConnectorLines falls back to revealing the whole path at once instead of
  // segment-by-segment.
  const highlightChainArray = useMemo(() => (highlightedIds ? [...highlightedIds] : []), [highlightedIds]);
  const locatedChainIndex = useMemo(
    () => (isTraveling && locatedId ? highlightChainArray.indexOf(locatedId) : -1),
    [isTraveling, highlightChainArray, locatedId]
  );

  // The little "travel car" marker (Find Connection) — rides the ACTUAL connector
  // geometry (a vertical drop, a horizontal run, another vertical drop) instead of
  // gliding in a straight line between two node centres, so it visibly takes the
  // same turns the red line does rather than cutting diagonally across cards.
  // `currentLink` is whichever highlighted segment the travel is currently
  // crossing; index 0 (sitting at the very first node, before the first hop has
  // even started) has none yet, so the car rests at that link's own start point.
  const currentLink = locatedChainIndex > 0 ? highlightedLinks[locatedChainIndex - 1] : null;
  // Falls back to the located node's own position (not a link) whenever there's no
  // usable segment to ride: at the very start, OR right after a mid-travel jump —
  // the new pedigree view rarely still draws the segment leading INTO the bridge
  // person, since that segment usually lived entirely in the view just left, so
  // without this the car would simply vanish for the length of the jump detour.
  const locatedNode = locatedChainIndex >= 0
    ? layout.nodes.find((n) => n.person.id === locatedId || n.spouse?.id === locatedId)
    : null;
  const carFallbackPoint = locatedNode ? { x: individualX(locatedNode, locatedId), y: locatedNode.y + 60, angle: 0 } : null;
  const carRestPoint = currentLink
    ? null
    : (locatedChainIndex === 0 && highlightedLinks[0]
        ? pointAlongLink(highlightedLinks[0], 0)
        : carFallbackPoint);
  const showCar = locatedChainIndex >= 0 && (currentLink || carRestPoint);

  // "Find Connection" travel label — names whoever the car has just reached,
  // relative to the PREVIOUS person on the chain (not the trip's overall start),
  // so a long trip reads as a relay of hand-offs — "Manikandan's Father ·
  // Kesavamoorthy", then "Kesavamoorthy's Father · Subramaniyan", then
  // "Subramaniyan's Daughter · Amutha" — rather than every stop being awkwardly
  // re-explained relative to Manikandan regardless of how far removed it is by
  // then. Reuses locatedNode's own position (not the car's per-frame one), so
  // the text doesn't jitter mid-glide. Keyed off locatedChainIndex rather than
  // isTraveling so the final stop's label stays up after arrival too, matching
  // how the highlighted path itself stays drawn.
  const travelLabel = useMemo(() => {
    if (locatedChainIndex <= 0 || !locatedId) return null;
    const fromId = highlightChainArray[locatedChainIndex - 1];
    const fromPerson = getPerson(persons, fromId);
    const toPerson = getPerson(persons, locatedId);
    if (!fromPerson || !toPerson) return null;
    const relation = getRelationshipLabel(persons, locatedId, fromId);
    return relation ? `${fromPerson.firstName}'s ${relation} · ${toPerson.firstName}` : toPerson.firstName;
  }, [highlightChainArray, locatedChainIndex, locatedId, persons]);
  const labelPoint = travelLabel && locatedNode
    ? { x: individualX(locatedNode, locatedId), y: locatedNode.y + AVATAR_TOP }
    : null;

  const carRef = useRef(null);
  const carAnimRef = useRef(null);
  useEffect(() => {
    cancelAnimationFrame(carAnimRef.current);
    if (!currentLink || !carRef.current) return undefined;
    const duration = travelTransitionMs ?? 220;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease in/out rather than constant speed — matches the camera pan's own
      // cubic-bezier easing so the car doesn't feel like it's on a different clock.
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const pt = pointAlongLink(currentLink, eased);
      if (carRef.current) {
        carRef.current.style.transform = `translate(${pt.x - 14}px, ${pt.y - 14}px) rotate(${pt.angle}deg)`;
      }
      if (t < 1) carAnimRef.current = requestAnimationFrame(tick);
    };
    carAnimRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(carAnimRef.current);
  }, [currentLink, travelTransitionMs]);

  // Dad-side/mom-side highlighting: whichever two lineage trees are the current
  // focus person's father's and mother's, tinted so their halves of the diagram
  // (or, in Full Tree View, just their two trees among everyone else's) stand out.
  // Extends ONE hop across a marriage bridge — e.g. a paternal aunt who married
  // into a separate root tree still tints as "father" side, not just the tree
  // that's directly the father's own blood-descendant line. Deliberately NOT a
  // full transitive BFS across every bridge reachable from there: in a real,
  // densely-married family, bridges chain together fast enough that an unbounded
  // walk eventually swallows the ENTIRE forest into one cluster, making the two
  // sides indistinguishable. One hop is exactly the case this is for — someone
  // bridged straight off father's/mother's own blood tree — without chaining
  // through THAT tree's own further, unrelated marriages.
  //
  // The father-root and mother-root are themselves ALWAYS directly bridged —
  // that's literally how they became "father" and "mother" (rootId's own two
  // parents married each other) — so that specific bridge has to be excluded
  // from each side's own one-hop expansion, or the very first hop would always
  // immediately re-merge both sides back together.
  const { fatherRootId, motherRootId } = useMemo(() => getLineageRootIds(persons, rootId), [persons, rootId]);
  const { fatherSideRoots, motherSideRoots } = useMemo(() => {
    const bridges = findRootBridges(persons, rootIds);
    const directBridgesOf = (startId, excludeId) => {
      const set = new Set(startId ? [startId] : []);
      if (!startId) return set;
      bridges.forEach(({ a, b }) => {
        if (a === startId && b !== excludeId) set.add(b);
        if (b === startId && a !== excludeId) set.add(a);
      });
      return set;
    };
    return {
      fatherSideRoots: directBridgesOf(fatherRootId, motherRootId),
      motherSideRoots: directBridgesOf(motherRootId, fatherRootId),
    };
  }, [persons, rootIds, fatherRootId, motherRootId]);
  const sideOf = useCallback(
    (node) => {
      if (!node.treeRootId) return null;
      if (fatherSideRoots.has(node.treeRootId)) return 'father';
      if (motherSideRoots.has(node.treeRootId)) return 'mother';
      return null;
    },
    [fatherSideRoots, motherSideRoots]
  );

  const containerRef = useRef(null);
  const worldRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 40 });
  const drag = useRef(null);
  // Every currently-active touch/pointer on the canvas, keyed by pointerId — needed
  // (instead of just `drag`) to detect a second finger landing for pinch-to-zoom, and
  // to keep tracking positions even for a pointer that started on a card/button (see
  // onMouseDown below) so it still counts if a second finger joins it mid-tap.
  const pointers = useRef(new Map());
  // Pinch-zoom baseline captured the moment a 2nd finger touches down: the starting
  // finger-to-finger distance and zoom level, so the live ratio between the current
  // and starting distance can be applied as a multiplier — re-baselined every time a
  // finger lifts (see endDrag) so releasing one finger never snaps the zoom.
  const pinch = useRef(null);
  const didCenter = useRef(false);
  // Gates the CSS transition below — on while zooming via the +/- buttons so the jump
  // eases in smoothly, off while drag-panning so the tree tracks the cursor instantly.
  const [isDragging, setIsDragging] = useState(false);
  // Also off while wheel/trackpad-zooming: a wheel burst fires many ticks per second,
  // and re-triggering the 220ms ease on every tick made the view visibly lag ~250ms
  // behind the input (each new tick restarts the ease from the current in-flight
  // position toward a new target). Wheel zoom instead tracks 1:1, like dragging.
  const [isWheeling, setIsWheeling] = useState(false);
  const wheelTimeoutRef = useRef(null);
  // Mirrors `zoom` for synchronous reads inside zoomAt/handleWheel/zoomBy, since those
  // need the up-to-date value without waiting for a re-render (state setter callbacks
  // firing back-to-back, e.g. rapid wheel events, would otherwise read a stale `zoom`).
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Tracked purely for the mini-map, so its viewport rectangle stays accurate
  // across window/panel resizes without the main pan/zoom logic depending on it.
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = () => setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // `.tree-canvas` should never natively scroll — panning is done entirely via the
  // `.tree-world` transform below. The CSS `overflow: clip` on `.tree-canvas`
  // (FamilyTree.css) is the real fix for this: unlike `hidden`, `clip` isn't a
  // scroll container per spec, so focusing a mini-card <button> on tap can't make
  // the browser auto-scroll it into view — that native auto-scroll was fighting
  // the transform pan and is what caused taps to jerk the whole canvas around
  // unpredictably ("position moving wildly"). This listener is only a fallback for
  // browsers old enough to not support `overflow: clip` (where the CSS falls back
  // to `hidden`, which IS a scroll container): it reacts to the 'scroll' event
  // (fired asynchronously, after the native scroll already happened) and snaps the
  // offset back to 0 — better than nothing there, but not race-free like `clip` is.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const resetScroll = () => {
      if (el.scrollLeft !== 0 || el.scrollTop !== 0) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      }
    };
    el.addEventListener('scroll', resetScroll);
    return () => el.removeEventListener('scroll', resetScroll);
  }, []);

  // Centres the viewport on the focus person's node (falls back to tree centre).
  const centerTree = useCallback(() => {
    const el = containerRef.current;
    if (!el || !layout.width) return;
    const focusNode = layout.nodes.find((n) => n.person.id === rootId || n.spouse?.id === rootId);
    if (focusNode) {
      setPan({
        x: el.clientWidth / 2 - individualX(focusNode, rootId),
        y: el.clientHeight / 2 - focusNode.y - 60,
      });
    } else {
      setPan({ x: Math.max((el.clientWidth - layout.width) / 2, 20), y: 40 });
    }
  }, [layout, rootId]);

  // Re-centre when the *pedigree* root changes (e.g. "Jump to their family" from one
  // lineage to another while already in Pedigree View), and reset zoom back to 1 at
  // the same time. Without the zoom reset, a level carried over from whatever was
  // previously on screen breaks the auto-centring math for the new layout:
  // centerTree()'s pan formula assumes zoom 1, so at any other zoom the computed pan
  // lands the content off-screen — it looks blank until "reset view" is clicked
  // (which resets zoom AND pan together, masking the bug). Gated to Pedigree View
  // only: that's the one mode where rootId actually reshapes the layout (forestLayout
  // is keyed on priorityId, not rootId) — in Forest View, rootId only changes from
  // plain focus/select taps as you browse around, and re-centring the camera on every
  // tap made the view jump wildly instead of staying put.
  useEffect(() => {
    if (mode !== 'pedigree') return;
    didCenter.current = false;
    setZoom(1);
  }, [rootId, mode]);

  useEffect(() => {
    didCenter.current = false;
    setZoom(1);
  }, [mode]);

  useEffect(() => {
    if (!didCenter.current && layout.width) {
      centerTree();
      didCenter.current = true;
    }
  }, [layout.width, centerTree]);

  // Force-centre on an explicit Locate request (search click / Locate Me). Keyed on the
  // bumping nonce so it fires every time — including when the target is already rootId,
  // where the rootId-change effect above stays silent and nothing would otherwise move.
  useEffect(() => {
    if (!locateNonce || !locateId) return;
    const el = containerRef.current;
    if (!el || !layout.width) return;
    const node = layout.nodes.find((n) => n.person.id === locateId || n.spouse?.id === locateId);
    if (!node) {
      // The target isn't drawn in this view (e.g. a trimmed satellite person in the
      // Full Tree) — ask App to escalate to a view where they are shown.
      onLocateNotFound?.(locateId);
      return;
    }
    setZoom(1);
    setPan({ x: el.clientWidth / 2 - individualX(node, locateId), y: el.clientHeight / 2 - node.y - 60 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateNonce]);

  // Changes zoom while keeping the world point under (anchorX, anchorY) — a
  // viewport-relative pixel coordinate — visually fixed in place. `.tree-world`'s
  // transform-origin is 0 0, so scaling always pivots on the far corner of the
  // whole tree; without this pan correction any zoom change (buttons or wheel)
  // would visibly yank the content toward/away from that corner instead of the
  // point the user is actually looking at, which is what made zoom feel "random".
  const zoomAt = useCallback((anchorX, anchorY, nextZoom) => {
    // Captured now, not read inside the setPan updater below — that callback runs
    // later during React's commit, by which point a same-tick zoomRef mutation
    // would already read as `nextZoom`, collapsing the ratio to 1 and silently
    // disabling the anchor correction (the bug that made zoom drift off-centre).
    const prevZoom = zoomRef.current;
    setPan((p) => ({
      x: anchorX - (anchorX - p.x) * (nextZoom / prevZoom),
      y: anchorY - (anchorY - p.y) * (nextZoom / prevZoom),
    }));
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  }, []);

  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      const el = containerRef.current;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current - e.deltaY * 0.0015));
      // Anchor on the viewport centre (not the cursor) so wheel zoom matches the
      // +/- buttons and always zooms toward what's currently in the middle of the screen.
      zoomAt(el.clientWidth / 2, el.clientHeight / 2, next);
      setIsWheeling(true);
      clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = setTimeout(() => setIsWheeling(false), 150);
    },
    [zoomAt]
  );

  const pinchDistance = (pts) => Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  // A finger starting on a card still needs to pan if it moves — but a plain tap
  // must reach the card's onClick, so panning only "activates" once the finger has
  // travelled past this many px, and pointer capture is deferred until then so the
  // browser is still free to fire a normal click for anything under it.
  const PAN_ACTIVATE_PX = 8;
  // Set true the moment a drag activates, read by suppressClick below — kept separate
  // from drag.current since endDrag (pointerup) clears that before the resulting
  // `click` event fires, so drag.current.active is already gone by the time it matters.
  const draggedRef = useRef(false);

  const onMouseDown = (e) => {
    // Track every pointer's position regardless of what it started on — a finger
    // resting on a card still needs to count toward a pinch gesture if a second
    // finger comes down elsewhere.
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      // Two fingers down = pinch-zoom, even if one of them started on a card —
      // capture both now and abandon any single-finger pan/tap in progress.
      drag.current = null;
      pointers.current.forEach((_, id) => {
        try {
          e.currentTarget.setPointerCapture(id);
        } catch {
          // pointer may already be gone — safe to ignore
        }
      });
      const pts = [...pointers.current.values()].slice(0, 2);
      pinch.current = { startDist: pinchDistance(pts) || 1, startZoom: zoomRef.current };
      setIsDragging(true);
      return;
    }

    if (e.button !== 0) return;
    // `active: false` until movement clears PAN_ACTIVATE_PX (see onMouseMove) — lets a
    // tap on a card/button still register as a click instead of being hijacked as a pan.
    drag.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, active: false };
    draggedRef.current = false;
  };
  const onMouseMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current && pointers.current.size >= 2) {
      const el = containerRef.current;
      if (!el) return;
      const pts = [...pointers.current.values()].slice(0, 2);
      const rect = el.getBoundingClientRect();
      const anchorX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const anchorY = (pts[0].y + pts[1].y) / 2 - rect.top;
      const ratio = pinchDistance(pts) / pinch.current.startDist;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.current.startZoom * ratio));
      zoomAt(anchorX, anchorY, next);
      return;
    }

    if (!drag.current) return;
    if (!drag.current.active) {
      const moved = Math.hypot(e.clientX - drag.current.startX, e.clientY - drag.current.startY);
      if (moved < PAN_ACTIVATE_PX) return;
      drag.current.active = true;
      draggedRef.current = true;
      setIsDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore — capture is best-effort
      }
    }
    setPan({
      x: drag.current.panX + (e.clientX - drag.current.startX),
      y: drag.current.panY + (e.clientY - drag.current.startY),
    });
  };
  const endDrag = (e) => {
    pointers.current.delete(e.pointerId);
    if (e?.currentTarget?.releasePointerCapture && e.pointerId != null && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore — pointer may already have been released by the browser
      }
    }

    if (pointers.current.size >= 2) {
      // Still pinching with the remaining fingers — re-baseline so lifting one
      // finger doesn't snap the zoom to a new value.
      const pts = [...pointers.current.values()].slice(0, 2);
      pinch.current = { startDist: pinchDistance(pts) || 1, startZoom: zoomRef.current };
      return;
    }

    pinch.current = null;

    if (pointers.current.size === 1) {
      // Dropped from two fingers to one — resume single-finger panning from
      // here instead of jumping back to wherever the very first touch started.
      const [[, pos]] = pointers.current.entries();
      drag.current = { startX: pos.x, startY: pos.y, panX: pan.x, panY: pan.y, active: true };
      return;
    }

    drag.current = null;
    setIsDragging(false);
  };

  // A drag that moved past PAN_ACTIVATE_PX shouldn't also trigger whatever card/button
  // the finger happened to end up over — otherwise panning across a person opens their
  // detail view the moment you lift your finger.
  const suppressClick = (e) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // Anchored on the viewport centre so the +/- buttons zoom toward/away from whatever
  // is currently in the middle of the screen, matching what the wheel zoom does at
  // the cursor — instead of leaving pan untouched, which pivots around the tree's
  // top-left corner (transform-origin 0 0) and feels like the view jumps randomly.
  const zoomBy = useCallback(
    (delta) => {
      const el = containerRef.current;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current + delta));
      if (!el) {
        zoomRef.current = next;
        setZoom(next);
        return;
      }
      zoomAt(el.clientWidth / 2, el.clientHeight / 2, next);
    },
    [zoomAt]
  );

  const resetView = () => {
    setZoom(1);
    zoomRef.current = 1;
    centerTree();
  };

  // Mini-map click/drag: re-centre the viewport on the tree-space point clicked,
  // at whatever zoom level is currently active.
  const handleMiniMapNavigate = useCallback((treeX, treeY) => {
    const el = containerRef.current;
    if (!el) return;
    setPan({
      x: el.clientWidth / 2 - treeX * zoomRef.current,
      y: el.clientHeight / 2 - treeY * zoomRef.current,
    });
  }, []);

  // Exposed to App.jsx (via ref) for the Export Image/PDF buttons — captures
  // exactly what's currently visible in the viewport, not the whole tree, since
  // large trees can be enormous once fully unrolled.
  useImperativeHandle(exportRef, () => ({
    async exportImage() {
      try {
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await captureFullTree(html2canvas, worldRef.current, null);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Could not render the tree to an image.');
        await shareOrDownloadFile(blob, 'family-tree.png', 'image/png');
      } catch (err) {
        console.error('Export Image failed:', err);
        window.alert(`Export Image failed: ${err?.message || err}`);
      }
    },
    async exportPDF() {
      try {
        const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
        const canvas = await captureFullTree(html2canvas, worldRef.current, '#ffffff');
        const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
        const pdf = new jsPDF({ orientation, unit: 'px', format: [canvas.width, canvas.height] });
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
        await shareOrDownloadFile(pdf.output('blob'), 'family-tree.pdf', 'application/pdf');
      } catch (err) {
        console.error('Export PDF failed:', err);
        window.alert(`Export PDF failed: ${err?.message || err}`);
      }
    },
  }));

  return (
    <div className="tree-viewport">
      <div
        ref={containerRef}
        className="tree-canvas"
        onWheel={handleWheel}
        onPointerDown={onMouseDown}
        onPointerMove={onMouseMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={suppressClick}
      >
        <div
          ref={worldRef}
          className="tree-world"
          style={{
            width: Math.max(layout.width, 1),
            height: Math.max(layout.height + NODE_H, 1),
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: isDragging || isWheeling
              ? 'none'
              // "Find Connection" travel: a long, slow transition (near the full gap
              // between hops) so the camera glides continuously from node to node —
              // a "drive" — instead of the normal quick snap-then-idle-pause centring
              // used everywhere else (locate/search/set-root).
              : `transform ${travelTransitionMs ?? 220}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          }}
        >
          <ConnectorLines
            links={layout.links}
            width={layout.width}
            height={layout.height}
            highlightedLinks={highlightedLinks}
            revealIndex={locatedChainIndex}
            transitionMs={travelTransitionMs}
          />
          {layout.nodes.map((node, index) => (
            <TreeNode
              key={node.id}
              node={node}
              index={index}
              focusId={rootId}
              renderedIds={renderedIds}
              side={sideOf(node)}
              highlightedIds={highlightedIds}
              meId={meId}
              onFocus={onFocus}
              locatedId={locatedId}
              onSelect={onSelect}
              onToggle={onToggle}
              onQuickAdd={onQuickAdd}
              onJumpTo={onJumpTo}
            />
          ))}
          {showCar && (
            <div
              ref={carRef}
              className="travel-car"
              // No CSS transition here — the RAF loop above already drives a new
              // transform every frame while a segment is in flight, and a CSS
              // transition layered on top of per-frame updates would keep re-easing
              // from whatever the last frame happened to be, reading as lag/stutter
              // instead of smooth motion. At rest (carRestPoint, no active segment)
              // a plain static position is all that's needed.
              style={
                currentLink
                  ? undefined
                  : {
                      transform: `translate(${carRestPoint.x - 14}px, ${carRestPoint.y - 14}px) rotate(${carRestPoint.angle}deg)`,
                    }
              }
            >
              {/* Top-down car glyph (not a side-view emoji) so rotating it to face
                  the current leg's direction — up/down/left/right — actually reads
                  as the car turning, instead of a sideways car spinning oddly. */}
              <svg width="24" height="24" viewBox="0 0 24 24">
                <rect x="7" y="2" width="10" height="20" rx="4" fill="#e63946" stroke="#7a1f27" strokeWidth="1" />
                <rect x="9" y="4.5" width="6" height="5" rx="1.5" fill="#bfe3ff" />
                <rect x="4.5" y="6" width="2.2" height="4" rx="1" fill="#1f1f1f" />
                <rect x="17.3" y="6" width="2.2" height="4" rx="1" fill="#1f1f1f" />
                <rect x="4.5" y="14" width="2.2" height="4" rx="1" fill="#1f1f1f" />
                <rect x="17.3" y="14" width="2.2" height="4" rx="1" fill="#1f1f1f" />
              </svg>
            </div>
          )}
          {travelLabel && labelPoint && (
            // Remounted (via `key`) on every hop so the fade/pop-in CSS animation
            // replays for each new stop instead of only ever running once.
            <div
              key={locatedId}
              className="travel-label"
              style={{ transform: `translate(${labelPoint.x}px, ${labelPoint.y}px) translate(-50%, -100%)` }}
            >
              {travelLabel}
            </div>
          )}
        </div>
      </div>

      <MiniMap
        nodes={layout.nodes}
        treeWidth={layout.width}
        treeHeight={layout.height}
        pan={pan}
        zoom={zoom}
        viewportSize={viewportSize}
        onNavigate={handleMiniMapNavigate}
      />

      <div className="tree-controls">
        <button type="button" onClick={() => zoomBy(0.15)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(-0.15)} title="Zoom out">{'−'}</button>
        <button type="button" onClick={resetView} title="Reset view">{'↻'}</button>
      </div>
    </div>
  );
});

export default FamilyTree;
