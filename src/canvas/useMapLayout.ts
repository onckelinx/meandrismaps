/**
 * Computes the target layout from the document and tweens the displayed
 * layout towards it, so structural changes move nodes smoothly instead of
 * jumping. Typing (draft-only changes) updates instantly.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapDocument, NodeId } from "../document/model";
import { computeBoundaries } from "../layout/boundaries";
import { computeBounds, layoutMap, outAnchor, type ImageLayout, type MapLayout, type NodeLayout } from "../layout/layout";
import { createCanvasMeasurer, type MeasureWidth } from "../layout/text";
import { useEditor } from "../state/store";

const DURATION = 240;
/** Above this many visible nodes, skip animation to keep large maps responsive. */
const ANIMATE_LIMIT = 700;

let measurer: MeasureWidth | null = null;
export function getMeasurer(): MeasureWidth {
  if (!measurer) measurer = createCanvasMeasurer();
  return measurer;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useMapLayout(): { target: MapLayout; display: MapLayout } {
  const doc = useEditor((s) => s.doc);
  const editingId = useEditor((s) => s.editing?.id);
  const draft = useEditor((s) => s.editing?.draft);

  const previous = useRef<MapLayout | null>(null);
  const target = useMemo(() => {
    const next = layoutMap(doc, {
      measure: getMeasurer(),
      editing: editingId !== undefined && draft !== undefined ? { id: editingId, text: draft } : undefined,
    });
    const shared = previous.current ? shareUnchanged(previous.current, next) : next;
    previous.current = shared;
    return shared;
  }, [doc, editingId, draft]);

  const [display, setDisplay] = useState(target);
  const displayRef = useRef(display);
  displayRef.current = display;
  const lastDoc = useRef<MapDocument>(doc);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const structural = lastDoc.current !== doc;
    lastDoc.current = doc;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const from = displayRef.current;
    if (!structural || reducedMotion() || target.order.length > ANIMATE_LIMIT || from === target) {
      setDisplay(target);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION);
      const e = 1 - Math.pow(1 - t, 3);
      setDisplay(t >= 1 ? target : interpolateLayout(doc, from, target, e));
      frame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, doc]);

  return { target, display };
}

function sameNode(a: NodeLayout, b: NodeLayout): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.parentId === b.parentId &&
    a.depth === b.depth &&
    a.side === b.side &&
    a.color === b.color &&
    a.style === b.style &&
    a.hiddenCount === b.hiddenCount &&
    a.collapsed === b.collapsed &&
    a.hasChildren === b.hasChildren &&
    a.lines.length === b.lines.length &&
    a.lines.every((l, i) => l === b.lines[i])
  );
}

/**
 * Reuses node objects that did not change, so memoised node and branch
 * components only re-render where the layout actually moved.
 */
export function shareUnchanged(prev: MapLayout, next: MapLayout): MapLayout {
  for (const [id, n] of next.nodes) {
    const old = prev.nodes.get(id);
    if (old && old !== n && sameNode(old, n)) next.nodes.set(id, old);
  }
  return next;
}

/** Layout with node positions blended between `from` and `to`. */
export function interpolateLayout(doc: MapDocument, from: MapLayout, to: MapLayout, t: number): MapLayout {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const nodes = new Map<NodeId, NodeLayout>();
  for (const id of to.order) {
    const n = to.nodes.get(id)!;
    let start = from.nodes.get(id);
    if (!start) {
      // New nodes grow out of their parent's branch end.
      const parentFrom = n.parentId ? (from.nodes.get(n.parentId) ?? nodes.get(n.parentId)) : undefined;
      if (parentFrom) {
        const a = outAnchor(parentFrom);
        start = { ...n, x: n.side === "left" ? a.x - n.width : a.x, y: a.y - n.height };
      } else start = n;
    }
    nodes.set(id, { ...n, x: lerp(start.x, n.x), y: lerp(start.y, n.y) });
  }
  const images: ImageLayout[] = to.images.map((img) => {
    const ownerId = img.image.nodeId;
    if (!ownerId) return img;
    const now = nodes.get(ownerId)!;
    const fin = to.nodes.get(ownerId)!;
    return { ...img, rect: { ...img.rect, x: img.rect.x + now.x - fin.x, y: img.rect.y + now.y - fin.y } };
  });
  const boundaries = computeBoundaries(doc, nodes, to.order, images);
  return { nodes, order: to.order, images, boundaries, bounds: computeBounds(nodes, images, boundaries) };
}
