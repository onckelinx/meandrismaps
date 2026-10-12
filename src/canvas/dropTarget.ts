/**
 * Where a dragged topic would land. Pure function of the layout and pointer
 * position, so the preview shown while dragging is exactly what a drop does.
 */
import type { MapDocument, NodeId, Side } from "../document/model";
import { isInSubtree } from "../document/queries";
import { outAnchor, type MapLayout, type NodeLayout } from "../layout/layout";

export interface DropTarget {
  parentId: NodeId;
  /** Index among the parent's children, counted before the move. */
  index: number;
  /** Side for a new top-level branch. */
  side?: Side;
  /** How the drop relates to the topic under the pointer (for the preview). */
  mode: "child" | "before" | "after";
  /** The topic under/near the pointer. */
  refId: NodeId;
}

function sideChildren(doc: MapDocument, layout: MapLayout, parentId: NodeId, side?: Side) {
  return doc.nodes[parentId].children.filter((c) => {
    const l = layout.nodes.get(c);
    return l && (!side || l.side === side);
  });
}

/** Index that places a new child of `parentId` at the pointer's height. */
function indexByY(doc: MapDocument, layout: MapLayout, parentId: NodeId, my: number, draggedId: NodeId, side?: Side): number {
  const all = doc.nodes[parentId].children;
  const kids = sideChildren(doc, layout, parentId, side).filter((c) => c !== draggedId);
  for (const c of kids) {
    const l = layout.nodes.get(c)!;
    if (my < l.y + l.height / 2) return all.indexOf(c);
  }
  if (!kids.length) return all.length;
  return all.indexOf(kids[kids.length - 1]) + 1;
}

export function findDropTarget(
  doc: MapDocument,
  layout: MapLayout,
  draggedId: NodeId,
  mx: number,
  my: number,
): DropTarget | null {
  const candidates: NodeLayout[] = [];
  for (const n of layout.nodes.values()) {
    if (!isInSubtree(doc, n.id, draggedId)) candidates.push(n);
  }

  // 1. Directly over a topic.
  for (const n of candidates) {
    const padX = 10;
    const padY = 6;
    if (mx < n.x - padX || mx > n.x + n.width + padX || my < n.y - padY || my > n.y + n.height + padY) continue;
    if (n.side === "root") {
      const side: Side = doc.settings.layout === "right" || mx >= n.x + n.width / 2 ? "right" : "left";
      return { parentId: n.id, index: indexByY(doc, layout, n.id, my, draggedId, side), side, mode: "child", refId: n.id };
    }
    const rel = (my - n.y) / n.height;
    const parent = n.parentId!;
    const siblings = doc.nodes[parent].children;
    const side = parent === doc.rootId ? (n.side as Side) : undefined;
    if (rel < 0.3) return { parentId: parent, index: siblings.indexOf(n.id), side, mode: "before", refId: n.id };
    if (rel > 0.75) return { parentId: parent, index: siblings.indexOf(n.id) + 1, side, mode: "after", refId: n.id };
    return { parentId: n.id, index: doc.nodes[n.id].children.length, mode: "child", refId: n.id };
  }

  // 2. In the open space beyond a topic's branch end: becomes its child.
  let best: { n: NodeLayout; d: number } | null = null;
  for (const n of candidates) {
    if (n.side === "root") continue;
    const a = outAnchor(n);
    const dir = n.side === "left" ? -1 : 1;
    const dx = (mx - a.x) * dir;
    if (dx < 0 || dx > 180) continue;
    const kids = sideChildren(doc, layout, n.id).filter((c) => c !== draggedId);
    let top = a.y - 36;
    let bottom = a.y + 36;
    for (const c of kids) {
      const l = layout.nodes.get(c)!;
      top = Math.min(top, l.y - 12);
      bottom = Math.max(bottom, l.y + l.height + 12);
    }
    if (my < top || my > bottom) continue;
    const d = dx + Math.abs(my - a.y) * 0.5;
    if (!best || d < best.d) best = { n, d };
  }
  if (best) {
    const n = best.n;
    return { parentId: n.id, index: indexByY(doc, layout, n.id, my, draggedId), mode: "child", refId: n.id };
  }

  // 3. Beside the root, beyond its first ring: a new top-level branch.
  const root = layout.nodes.get(doc.rootId)!;
  const rcx = root.x + root.width / 2;
  const rcy = root.y + root.height / 2;
  if (Math.abs(my - rcy) < 260 && Math.abs(mx - rcx) < root.width / 2 + 140) {
    const side: Side = doc.settings.layout === "right" || mx >= rcx ? "right" : "left";
    return { parentId: doc.rootId, index: indexByY(doc, layout, doc.rootId, my, draggedId, side), side, mode: "child", refId: doc.rootId };
  }
  return null;
}

/** True when dropping would leave the topic exactly where it is. */
export function isNoOpDrop(doc: MapDocument, draggedId: NodeId, t: DropTarget): boolean {
  const node = doc.nodes[draggedId];
  if (node.parentId !== t.parentId) return false;
  if (t.parentId === doc.rootId && t.side && t.side !== node.side) return false;
  const idx = doc.nodes[t.parentId].children.indexOf(draggedId);
  return t.index === idx || t.index === idx + 1;
}
