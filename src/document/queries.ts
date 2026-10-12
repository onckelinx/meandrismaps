import type { MapDocument, MapNode, NodeId, Side } from "./model";
import { PALETTE, ROOT_COLOR } from "./palette";

export function getNode(doc: MapDocument, id: NodeId): MapNode {
  const node = doc.nodes[id];
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
}

export function isRoot(doc: MapDocument, id: NodeId): boolean {
  return doc.rootId === id;
}

/** Ancestors from the parent up to (and including) the root. */
export function ancestors(doc: MapDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  let cur = doc.nodes[id]?.parentId ?? null;
  while (cur) {
    out.push(cur);
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return out;
}

/** True when `id` is `ancestorId` or lies somewhere beneath it. */
export function isInSubtree(doc: MapDocument, id: NodeId, ancestorId: NodeId): boolean {
  let cur: NodeId | null = id;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return false;
}

export function depth(doc: MapDocument, id: NodeId): number {
  return ancestors(doc, id).length;
}

/** All ids in the subtree rooted at `id`, pre-order, including `id`. */
export function subtreeIds(doc: MapDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    const node = doc.nodes[cur];
    if (node) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return out;
}

/** Node ids that are currently visible (not hidden inside a collapsed branch), pre-order. */
export function visibleIds(doc: MapDocument): NodeId[] {
  const out: NodeId[] = [];
  const stack = [doc.rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    const node = doc.nodes[cur];
    if (node && !node.collapsed) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
  }
  return out;
}

export function isVisible(doc: MapDocument, id: NodeId): boolean {
  return ancestors(doc, id).every((a) => !doc.nodes[a].collapsed);
}

/** Number of descendants (excluding the node itself). */
export function descendantCount(doc: MapDocument, id: NodeId): number {
  return subtreeIds(doc, id).length - 1;
}

/** The direct child of the root that this node belongs to (or null for the root). */
export function topLevelAncestor(doc: MapDocument, id: NodeId): NodeId | null {
  if (id === doc.rootId) return null;
  let cur = id;
  while (doc.nodes[cur].parentId !== doc.rootId) cur = doc.nodes[cur].parentId!;
  return cur;
}

/**
 * Side for each top-level branch. Explicit `side` values are honoured;
 * branches without one are distributed to keep the two sides balanced.
 */
export function resolveTopLevelSides(doc: MapDocument): Map<NodeId, Side> {
  const out = new Map<NodeId, Side>();
  const root = doc.nodes[doc.rootId];
  if (doc.settings.layout === "right") {
    for (const c of root.children) out.set(c, "right");
    return out;
  }
  let right = 0;
  let left = 0;
  for (const c of root.children) {
    const s = doc.nodes[c].side;
    if (s === "right") right++;
    else if (s === "left") left++;
  }
  for (const c of root.children) {
    let s = doc.nodes[c].side;
    if (!s) {
      s = right <= left ? "right" : "left";
      if (s === "right") right++;
      else left++;
    }
    out.set(c, s);
  }
  return out;
}

/** Visible leaves under a node: a good proxy for the height its branch occupies. */
function visibleLeaves(doc: MapDocument, id: NodeId): number {
  const node = doc.nodes[id];
  if (node.collapsed || !node.children.length) return 1;
  return node.children.reduce((s, c) => s + visibleLeaves(doc, c), 0);
}

/**
 * The side a new top-level branch should go to in the two-sided layout: the
 * visually lighter side, preferring `prefer` when balanced.
 */
export function sideForNewTopLevel(doc: MapDocument, prefer: Side = "right"): Side {
  if (doc.settings.layout === "right") return "right";
  const sides = resolveTopLevelSides(doc);
  const weight = { left: 0, right: 0 };
  for (const [id, s] of sides) weight[s] += visibleLeaves(doc, id);
  const other: Side = prefer === "right" ? "left" : "right";
  return weight[prefer] <= weight[other] ? prefer : other;
}

/** Colour the branch leading into this node is drawn with. */
export function effectiveColor(doc: MapDocument, id: NodeId): string {
  let cur: NodeId | null = id;
  while (cur) {
    const node: MapNode = doc.nodes[cur];
    if (node.color) return node.color;
    if (node.parentId === doc.rootId) {
      const idx = doc.nodes[doc.rootId].children.indexOf(cur);
      return PALETTE[Math.max(0, idx) % PALETTE.length].value;
    }
    cur = node.parentId;
  }
  return ROOT_COLOR;
}

/** The palette colour least used by existing top-level branches. */
export function nextBranchColor(doc: MapDocument): string {
  const counts = new Map(PALETTE.map((p) => [p.value, 0]));
  for (const c of doc.nodes[doc.rootId].children) {
    const col = doc.nodes[c].color;
    if (col && counts.has(col)) counts.set(col, counts.get(col)! + 1);
  }
  let best = PALETTE[0].value;
  let bestCount = Infinity;
  for (const p of PALETTE) {
    const n = counts.get(p.value)!;
    if (n < bestCount) {
      best = p.value;
      bestCount = n;
    }
  }
  return best;
}

/** Previous/next sibling, or null at the ends. */
export function sibling(doc: MapDocument, id: NodeId, delta: -1 | 1): NodeId | null {
  const parentId = doc.nodes[id].parentId;
  if (!parentId) return null;
  const siblings = doc.nodes[parentId].children;
  const idx = siblings.indexOf(id);
  return siblings[idx + delta] ?? null;
}
