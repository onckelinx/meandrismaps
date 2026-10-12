/** Arrow-key navigation over the laid-out map. */
import type { MapDocument, NodeId } from "../document/model";
import { sibling } from "../document/queries";
import type { MapLayout, NodeLayout } from "../layout/layout";

export type Direction = "up" | "down" | "left" | "right";

const centre = (n: NodeLayout) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

/** The visible child whose centre is vertically closest to the node's centre. */
function middleChild(doc: MapDocument, layout: MapLayout, id: NodeId, side?: "left" | "right"): NodeId | null {
  const node = layout.nodes.get(id);
  if (!node) return null;
  const cy = centre(node).y;
  let best: NodeId | null = null;
  let bestD = Infinity;
  for (const c of doc.nodes[id].children) {
    const cl = layout.nodes.get(c);
    if (!cl || (side && cl.side !== side)) continue;
    const d = Math.abs(centre(cl).y - cy);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function navigate(doc: MapDocument, layout: MapLayout, id: NodeId, dir: Direction): NodeId | null {
  const node = layout.nodes.get(id);
  if (!node) return doc.rootId;

  if (dir === "left" || dir === "right") {
    if (node.side === "root") return middleChild(doc, layout, id, dir);
    const outward = (node.side === "right") === (dir === "right");
    if (outward) return middleChild(doc, layout, id);
    return node.parentId;
  }

  // Up/down: previous/next sibling first (visually ordered top-to-bottom).
  if (node.parentId) {
    const delta = dir === "up" ? -1 : 1;
    let cand = sibling(doc, id, delta);
    // In the two-sided layout, root children on the other side are not "above/below".
    while (cand && layout.nodes.get(cand)?.side !== node.side) cand = sibling(doc, cand, delta);
    if (cand && layout.nodes.has(cand)) return cand;
  }

  // Otherwise the spatially nearest node in that direction, preferring the same column.
  const c = centre(node);
  let best: NodeId | null = null;
  let bestScore = Infinity;
  for (const other of layout.nodes.values()) {
    if (other.id === id) continue;
    const oc = centre(other);
    const dy = oc.y - c.y;
    if (dir === "up" ? dy >= -1 : dy <= 1) continue;
    const overlap = other.x < node.x + node.width && other.x + other.width > node.x;
    const score = Math.abs(dy) + Math.abs(oc.x - c.x) * (overlap ? 0.5 : 3);
    if (score < bestScore) {
      bestScore = score;
      best = other.id;
    }
  }
  return best;
}
