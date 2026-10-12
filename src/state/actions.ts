/**
 * High-level user actions shared by keyboard shortcuts, menus and context
 * menus. Each one is a single undoable step (or a merge into the step that
 * created the node being edited).
 */
import { newNodeId } from "../document/ids";
import type { Boundary, NodeId } from "../document/model";
import * as ops from "../document/ops";
import { sibling } from "../document/queries";
import { apply, discardLast, getState, select, setEditing, type Selection } from "./store";

export function selectedNodeId(): NodeId | null {
  const sel = getState().selection;
  return sel?.kind === "node" && getState().doc.nodes[sel.id] ? sel.id : null;
}

const nodeSel = (id: NodeId): Selection => ({ kind: "node", id });

export function startEditing(id: NodeId, opts: { draft?: string; selectAll?: boolean; isNew?: boolean } = {}) {
  const node = getState().doc.nodes[id];
  if (!node) return;
  setEditing({
    id,
    draft: opts.draft ?? node.text,
    isNew: opts.isNew ?? false,
    selectAll: opts.selectAll ?? false,
  });
  select(nodeSel(id));
}

/**
 * Finishes inline editing, committing the text. A new node left empty is
 * removed again. Returns the id of the edited node if it still exists.
 */
export function commitEditing(): NodeId | null {
  const s = getState();
  const e = s.editing;
  if (!e) return null;
  setEditing(null);
  const node = s.doc.nodes[e.id];
  if (!node) return null;
  const text = e.draft.replace(/\s+$/, "").replace(/^\s+/, "");
  const last = s.past[s.past.length - 1];
  const createdHere = last?.createdNodeId === e.id;
  if (e.isNew && text === "") {
    if (createdHere) discardLast();
    else apply("Delete", (d) => ops.deleteNode(d, e.id), { select: nodeSel(node.parentId!) });
    return null;
  }
  if (text !== node.text) {
    apply("Edit Text", (d) => ops.setText(d, e.id, text), { mergeWithLast: createdHere });
  }
  return e.id;
}

export function addChildAndEdit(parentId: NodeId) {
  const id = newNodeId();
  apply("Add Child", (d) => ops.addChild(d, parentId, { id }), { select: nodeSel(id), createdNodeId: id });
  setEditing({ id, draft: "", isNew: true, selectAll: false });
}

export function addSiblingAndEdit(refId: NodeId, position: "before" | "after" = "after") {
  const id = newNodeId();
  const isRoot = refId === getState().doc.rootId;
  apply(isRoot ? "Add Child" : "Add Sibling", (d) => ops.addSibling(d, refId, position, { id }), {
    select: nodeSel(id),
    createdNodeId: id,
  });
  setEditing({ id, draft: "", isNew: true, selectAll: false });
}

// --- Keys while the inline editor is open -------------------------------------

export function editorEnter() {
  const e = getState().editing;
  if (!e) return;
  const wasEmptyNew = e.isNew && e.draft.trim() === "";
  const id = commitEditing();
  if (!id || wasEmptyNew) return;
  addSiblingAndEdit(id);
}

export function editorTab() {
  const s = getState();
  const e = s.editing;
  if (!e) return;
  if (e.isNew && e.draft.trim() === "") {
    // Outliner-style indent: an empty new node becomes the last child of its
    // previous sibling, and editing continues.
    const prev = sibling(s.doc, e.id, -1);
    if (!prev) return;
    const createdHere = s.past[s.past.length - 1]?.createdNodeId === e.id;
    apply(
      "Add Child",
      (d) => ops.moveNode(d, e.id, prev, d.nodes[prev].children.length),
      { mergeWithLast: createdHere },
    );
    return;
  }
  const id = commitEditing();
  if (id) addChildAndEdit(id);
}

export function editorShiftTab() {
  const s = getState();
  const e = s.editing;
  if (!e) return;
  const createdHere = s.past[s.past.length - 1]?.createdNodeId === e.id;
  apply("Outdent", (d) => void ops.outdent(d, e.id), { mergeWithLast: createdHere });
}

// --- Selection-mode actions -------------------------------------------------------

export function deleteSelection() {
  const s = getState();
  const sel = s.selection;
  if (!sel) return;
  if (sel.kind === "image") {
    apply("Delete Image", (d) => ops.deleteImage(d, sel.id), { select: null });
    return;
  }
  if (sel.id === s.doc.rootId) return;
  const next = sibling(s.doc, sel.id, 1) ?? sibling(s.doc, sel.id, -1) ?? s.doc.nodes[sel.id].parentId!;
  apply("Delete", (d) => ops.deleteNode(d, sel.id), { select: nodeSel(next) });
}

export function toggleCollapse(id: NodeId) {
  const node = getState().doc.nodes[id];
  if (!node || !node.children.length) return;
  apply(node.collapsed ? "Expand" : "Collapse", (d) => ops.setCollapsed(d, id, !node.collapsed));
}

export function setAllCollapsed(collapsed: boolean) {
  apply(collapsed ? "Collapse All" : "Expand All", (d) => {
    for (const n of Object.values(d.nodes)) {
      if (n.id !== d.rootId) ops.setCollapsed(d, n.id, collapsed);
    }
  });
  const sel = selectedNodeId();
  if (collapsed && sel) {
    // Keep the selection on something visible.
    const doc = getState().doc;
    let cur = sel;
    let p = doc.nodes[cur].parentId;
    while (p && p !== doc.rootId) {
      if (doc.nodes[p].collapsed) cur = p;
      p = doc.nodes[p].parentId;
    }
    select(nodeSel(cur));
  }
}

export function reorderSelected(delta: number) {
  const id = selectedNodeId();
  if (id) apply("Move", (d) => void ops.reorder(d, id, delta));
}

export function outdentSelected() {
  const id = selectedNodeId();
  if (id) apply("Outdent", (d) => void ops.outdent(d, id));
}

export function setBranchColor(id: NodeId, color: string | undefined) {
  apply("Change Branch Color", (d) => ops.setColor(d, id, color));
}

export function setBoundary(id: NodeId, boundary: Boundary | undefined) {
  apply(boundary ? "Add Boundary" : "Remove Boundary", (d) => ops.setBoundary(d, id, boundary));
}

export function toggleBoundary(id: NodeId) {
  const has = !!getState().doc.nodes[id]?.boundary;
  setBoundary(id, has ? undefined : {});
}
