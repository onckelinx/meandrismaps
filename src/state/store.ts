/**
 * Editor state: the document, selection, inline-edit state and history.
 *
 * Every document change goes through `apply`, which records Immer patches so
 * undo/redo is one coherent mechanism rather than per-feature logic.
 */
import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { createStore, useStore } from "zustand";
import type { ImageId, MapDocument, NodeId } from "../document/model";
import { createDocument } from "../document/ops";

enablePatches();

export type Selection = { kind: "node"; id: NodeId } | { kind: "image"; id: ImageId } | null;

export interface Editing {
  id: NodeId;
  draft: string;
  /** Created by the current keyboard flow; discarded if left empty. */
  isNew: boolean;
  /** Select the whole text when the editor opens (otherwise caret at end). */
  selectAll: boolean;
}

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  selBefore: Selection;
  selAfter: Selection;
  /** Node created by this entry, so its first text edit can merge into it. */
  createdNodeId?: NodeId;
}

export interface EditorState {
  doc: MapDocument;
  selection: Selection;
  editing: Editing | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Top of `past` when the document was last saved (null = empty history). */
  savedEntry: HistoryEntry | null;
  filePath: string | null;
  /** Increments on every document change (for autosave). */
  revision: number;
}

export interface ApplyOptions {
  /** Selection after the change (defaults to unchanged). */
  select?: Selection;
  createdNodeId?: NodeId;
  /** Merge into the previous entry instead of creating a new one. */
  mergeWithLast?: boolean;
}

function initialState(doc: MapDocument, filePath: string | null): EditorState {
  return {
    doc,
    selection: { kind: "node", id: doc.rootId },
    editing: null,
    past: [],
    future: [],
    savedEntry: null,
    filePath,
    revision: 0,
  };
}

export const editorStore = createStore<EditorState>(() => initialState(createDocument(), null));

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(editorStore, selector);
}

export const getState = () => editorStore.getState();

/** Replace the whole document (New / Open / Import). Clears history. */
export function loadDocument(doc: MapDocument, filePath: string | null, dirty = false) {
  const s = initialState(doc, filePath);
  if (dirty) {
    // A sentinel entry makes the document dirty without being undoable.
    s.savedEntry = { label: "", patches: [], inverse: [], selBefore: null, selAfter: null };
  }
  editorStore.setState(s, true);
}

/** Applies a document change and records it in the history. Returns the recipe's result. */
export function apply<R>(label: string, recipe: (draft: MapDocument) => R, opts: ApplyOptions = {}): R | undefined {
  const state = getState();
  let result: R | undefined;
  const [next, patches, inverse] = produceWithPatches(state.doc, (draft: MapDocument) => {
    result = recipe(draft);
  });
  if (!patches.length) {
    if (opts.select !== undefined) editorStore.setState({ selection: opts.select });
    return result;
  }
  const selAfter = opts.select !== undefined ? opts.select : state.selection;
  const last = state.past[state.past.length - 1];
  let past: HistoryEntry[];
  if (opts.mergeWithLast && last && last !== state.savedEntry) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...patches],
      inverse: [...inverse, ...last.inverse],
      selAfter,
    };
    past = [...state.past.slice(0, -1), merged];
  } else {
    const entry: HistoryEntry = {
      label,
      patches,
      inverse,
      selBefore: state.selection,
      selAfter,
      createdNodeId: opts.createdNodeId,
    };
    past = [...state.past, entry];
    if (past.length > 500) past = past.slice(past.length - 500);
  }
  editorStore.setState({
    doc: next,
    past,
    future: [],
    selection: selAfter,
    revision: state.revision + 1,
  });
  return result;
}

/** Drops the most recent entry without making it redoable (e.g. an abandoned new node). */
export function discardLast() {
  const state = getState();
  const last = state.past[state.past.length - 1];
  if (!last) return;
  editorStore.setState({
    doc: applyPatches(state.doc, last.inverse),
    past: state.past.slice(0, -1),
    selection: last.selBefore,
    revision: state.revision + 1,
  });
}

export function undo() {
  const state = getState();
  const entry = state.past[state.past.length - 1];
  if (!entry) return;
  const doc = applyPatches(state.doc, entry.inverse);
  editorStore.setState({
    doc,
    past: state.past.slice(0, -1),
    future: [entry, ...state.future],
    selection: validSelection(doc, entry.selBefore),
    editing: null,
    revision: state.revision + 1,
  });
}

export function redo() {
  const state = getState();
  const entry = state.future[0];
  if (!entry) return;
  const doc = applyPatches(state.doc, entry.patches);
  editorStore.setState({
    doc,
    past: [...state.past, entry],
    future: state.future.slice(1),
    selection: validSelection(doc, entry.selAfter),
    editing: null,
    revision: state.revision + 1,
  });
}

function validSelection(doc: MapDocument, sel: Selection): Selection {
  if (!sel) return null;
  if (sel.kind === "node") return doc.nodes[sel.id] ? sel : { kind: "node", id: doc.rootId };
  return doc.images[sel.id] ? sel : null;
}

export function isDirty(s: EditorState = getState()): boolean {
  return (s.past[s.past.length - 1] ?? null) !== s.savedEntry;
}

export function markSaved(filePath: string) {
  const s = getState();
  editorStore.setState({ savedEntry: s.past[s.past.length - 1] ?? null, filePath });
}

export function select(selection: Selection) {
  editorStore.setState({ selection });
}

export function setEditing(editing: Editing | null) {
  editorStore.setState({ editing });
}

export function updateDraft(draft: string) {
  const e = getState().editing;
  if (e) editorStore.setState({ editing: { ...e, draft } });
}
