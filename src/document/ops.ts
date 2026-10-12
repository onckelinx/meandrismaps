/**
 * Tree operations. Each function mutates the document passed in (normally an
 * Immer draft) and preserves the invariants checked by `checkInvariants`.
 */
import { newNodeId } from "./ids";
import type {
  AssetInfo,
  Boundary,
  LayoutMode,
  MapDocument,
  MapImage,
  MapNode,
  NodeId,
  Side,
} from "./model";
import { nextBranchColor, isInSubtree, sideForNewTopLevel, subtreeIds } from "./queries";

export interface OutlineItem {
  text: string;
  children: OutlineItem[];
}

export function createDocument(rootText = ""): MapDocument {
  const rootId = newNodeId();
  const now = new Date().toISOString();
  return {
    rootId,
    nodes: {
      [rootId]: { id: rootId, text: rootText, parentId: null, children: [], collapsed: false },
    },
    images: {},
    assets: {},
    settings: { layout: "both" },
    meta: { created: now, modified: now },
  };
}

function makeNode(id: NodeId, parentId: NodeId, text: string): MapNode {
  return { id, text, parentId, children: [], collapsed: false };
}

/** Give a node that has just become a top-level branch its identity. */
function adoptAsTopLevel(doc: MapDocument, node: MapNode, side?: Side) {
  node.side = doc.settings.layout === "right" ? "right" : (side ?? node.side ?? sideForNewTopLevel(doc));
  if (!node.color) node.color = nextBranchColor(doc);
}

export interface AddOptions {
  text?: string;
  index?: number;
  id?: NodeId;
  /** Explicit side for a new top-level branch (otherwise balanced). */
  side?: Side;
}

export function addChild(doc: MapDocument, parentId: NodeId, opts: AddOptions = {}): NodeId {
  const parent = doc.nodes[parentId];
  if (!parent) throw new Error(`Unknown parent ${parentId}`);
  const id = opts.id ?? newNodeId();
  const node = makeNode(id, parentId, opts.text ?? "");
  if (parentId === doc.rootId) adoptAsTopLevel(doc, node, opts.side);
  doc.nodes[id] = node;
  const index = opts.index ?? parent.children.length;
  parent.children.splice(Math.max(0, Math.min(index, parent.children.length)), 0, id);
  parent.collapsed = false;
  return id;
}

/** Adds a sibling next to `id`. Adding a sibling to the root adds a child instead. */
export function addSibling(
  doc: MapDocument,
  id: NodeId,
  position: "before" | "after" = "after",
  opts: Omit<AddOptions, "index"> = {},
): NodeId {
  const node = doc.nodes[id];
  if (!node.parentId) return addChild(doc, id, opts);
  const parent = doc.nodes[node.parentId];
  const idx = parent.children.indexOf(id);
  // New top-level siblings stay on the same side unless that side is heavier.
  const side =
    node.parentId === doc.rootId ? (opts.side ?? sideForNewTopLevel(doc, node.side ?? "right")) : undefined;
  return addChild(doc, node.parentId, {
    ...opts,
    side,
    index: position === "after" ? idx + 1 : idx,
  });
}

/** Deletes a node, its descendants and any images attached to them. */
export function deleteNode(doc: MapDocument, id: NodeId) {
  if (id === doc.rootId) throw new Error("The root node cannot be deleted");
  const node = doc.nodes[id];
  if (!node) return;
  const removed = new Set(subtreeIds(doc, id));
  const parent = doc.nodes[node.parentId!];
  parent.children = parent.children.filter((c) => c !== id);
  for (const r of removed) delete doc.nodes[r];
  for (const img of Object.values(doc.images)) {
    if (img.nodeId && removed.has(img.nodeId)) delete doc.images[img.id];
  }
}

export function setText(doc: MapDocument, id: NodeId, text: string) {
  doc.nodes[id].text = text;
}

export function canMove(doc: MapDocument, id: NodeId, newParentId: NodeId): boolean {
  if (id === doc.rootId) return false;
  if (!doc.nodes[newParentId]) return false;
  return !isInSubtree(doc, newParentId, id);
}

/**
 * Moves `id` (with its subtree) under `newParentId` at `index` (index counted
 * in the new parent's children *before* the move).
 */
export function moveNode(
  doc: MapDocument,
  id: NodeId,
  newParentId: NodeId,
  index: number,
  side?: Side,
) {
  if (!canMove(doc, id, newParentId)) throw new Error("Invalid move");
  const node = doc.nodes[id];
  const oldParent = doc.nodes[node.parentId!];
  const oldIndex = oldParent.children.indexOf(id);
  const wasTopLevel = node.parentId === doc.rootId;
  const willBeTopLevel = newParentId === doc.rootId;

  oldParent.children.splice(oldIndex, 1);
  let target = index;
  if (oldParent.id === newParentId && oldIndex < index) target -= 1;
  const newParent = doc.nodes[newParentId];
  target = Math.max(0, Math.min(target, newParent.children.length));
  newParent.children.splice(target, 0, id);
  newParent.collapsed = false;
  node.parentId = newParentId;

  if (willBeTopLevel) {
    adoptAsTopLevel(doc, node, side);
  } else {
    delete node.side;
    // A top-level branch's colour is its identity on the root; once it becomes
    // part of another branch it should follow that branch's colour.
    if (wasTopLevel) delete node.color;
  }
}

/** Shift+Tab: make the node a sibling of its parent, placed right after it. */
export function outdent(doc: MapDocument, id: NodeId): boolean {
  const node = doc.nodes[id];
  if (!node.parentId || node.parentId === doc.rootId) return false;
  const parent = doc.nodes[node.parentId];
  const grand = doc.nodes[parent.parentId!];
  const side = grand.id === doc.rootId ? parent.side : undefined;
  moveNode(doc, id, grand.id, grand.children.indexOf(parent.id) + 1, side);
  return true;
}

/** Move among siblings by `delta` positions. */
export function reorder(doc: MapDocument, id: NodeId, delta: number): boolean {
  const node = doc.nodes[id];
  if (!node.parentId) return false;
  const siblings = doc.nodes[node.parentId].children;
  const idx = siblings.indexOf(id);
  const target = Math.max(0, Math.min(siblings.length - 1, idx + delta));
  if (target === idx) return false;
  siblings.splice(idx, 1);
  siblings.splice(target, 0, id);
  return true;
}

export function setCollapsed(doc: MapDocument, id: NodeId, collapsed: boolean) {
  const node = doc.nodes[id];
  node.collapsed = collapsed && node.children.length > 0;
}

/** Expands every ancestor so `id` becomes visible. Returns true if anything changed. */
export function reveal(doc: MapDocument, id: NodeId): boolean {
  let changed = false;
  let cur = doc.nodes[id]?.parentId ?? null;
  while (cur) {
    if (doc.nodes[cur].collapsed) {
      doc.nodes[cur].collapsed = false;
      changed = true;
    }
    cur = doc.nodes[cur].parentId;
  }
  return changed;
}

export function setColor(doc: MapDocument, id: NodeId, color: string | undefined) {
  if (color) doc.nodes[id].color = color;
  else delete doc.nodes[id].color;
}

export function setBoundary(doc: MapDocument, id: NodeId, boundary: Boundary | undefined) {
  if (boundary) doc.nodes[id].boundary = { ...boundary };
  else delete doc.nodes[id].boundary;
}

export function setSide(doc: MapDocument, id: NodeId, side: Side) {
  if (doc.nodes[id].parentId === doc.rootId) doc.nodes[id].side = side;
}

export function setLayoutMode(doc: MapDocument, mode: LayoutMode) {
  doc.settings.layout = mode;
}

// --- Images -----------------------------------------------------------------

export function addAsset(doc: MapDocument, info: AssetInfo) {
  doc.assets[info.id] = { ...info };
}

export function addImage(doc: MapDocument, image: MapImage) {
  doc.images[image.id] = { ...image };
}

export function updateImage(
  doc: MapDocument,
  id: string,
  patch: Partial<Pick<MapImage, "x" | "y" | "width" | "height">>,
) {
  Object.assign(doc.images[id], patch);
}

export function deleteImage(doc: MapDocument, id: string) {
  delete doc.images[id];
}

/** Attach an image to a node; `relX/relY` are relative to the node's centre. */
export function attachImage(doc: MapDocument, id: string, nodeId: NodeId, relX: number, relY: number) {
  const img = doc.images[id];
  img.nodeId = nodeId;
  img.x = relX;
  img.y = relY;
}

/** Detach an image; `x/y` are its map coordinates at the moment of detaching. */
export function detachImage(doc: MapDocument, id: string, x: number, y: number) {
  const img = doc.images[id];
  delete img.nodeId;
  img.x = x;
  img.y = y;
}

// --- Outlines (paste / import) ------------------------------------------------

/** Inserts an outline under `parentId`. Returns the ids of the inserted top items. */
export function insertOutline(
  doc: MapDocument,
  parentId: NodeId,
  items: OutlineItem[],
  index?: number,
): NodeId[] {
  const ids: NodeId[] = [];
  let at = index ?? doc.nodes[parentId].children.length;
  for (const item of items) {
    const id = addChild(doc, parentId, { text: item.text, index: at++ });
    ids.push(id);
    insertOutline(doc, id, item.children);
  }
  return ids;
}

export function toOutline(doc: MapDocument, id: NodeId): OutlineItem {
  const node = doc.nodes[id];
  return { text: node.text, children: node.children.map((c) => toOutline(doc, c)) };
}

/** Builds a fresh document from an outline whose single top item is the root. */
export function documentFromOutline(root: OutlineItem): MapDocument {
  const doc = createDocument(root.text);
  insertOutline(doc, doc.rootId, root.children);
  return doc;
}

// --- Invariants -----------------------------------------------------------------

/** Returns a list of invariant violations (empty when the document is sound). */
export function checkInvariants(doc: MapDocument): string[] {
  const errors: string[] = [];
  const root = doc.nodes[doc.rootId];
  if (!root) return ["root node missing"];
  if (root.parentId !== null) errors.push("root has a parent");
  const seen = new Set<NodeId>();
  const stack = [doc.rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) {
      errors.push(`node ${id} reachable twice`);
      continue;
    }
    seen.add(id);
    const node = doc.nodes[id];
    if (!node) {
      errors.push(`missing node ${id}`);
      continue;
    }
    if (node.id !== id) errors.push(`node key ${id} has id ${node.id}`);
    for (const c of node.children) {
      const child = doc.nodes[c];
      if (!child) errors.push(`node ${id} lists missing child ${c}`);
      else if (child.parentId !== id) errors.push(`child ${c} of ${id} has parent ${child.parentId}`);
      stack.push(c);
    }
  }
  for (const id of Object.keys(doc.nodes)) {
    if (!seen.has(id)) errors.push(`node ${id} unreachable from root`);
  }
  for (const img of Object.values(doc.images)) {
    if (img.nodeId && !doc.nodes[img.nodeId]) errors.push(`image ${img.id} attached to missing node`);
    if (!doc.assets[img.assetId]) errors.push(`image ${img.id} references missing asset`);
  }
  return errors;
}
