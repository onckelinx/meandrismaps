import { beforeEach, describe, expect, it } from "vitest";
import { leaveEditor } from "../canvas/editorKeys";
import { createDocument } from "../document/ops";
import * as ops from "../document/ops";
import {
  addChildAndEdit,
  addSiblingAndEdit,
  commitEditing,
  editorEnter,
  editorShiftTab,
  editorTab,
  startEditing,
} from "./actions";
import { apply, getState, isDirty, loadDocument, markSaved, redo, undo, updateDraft } from "./store";

const texts = (id: string) => getState().doc.nodes[id].children.map((c) => getState().doc.nodes[c].text);
const root = () => getState().doc.rootId;

beforeEach(() => loadDocument(createDocument(), null));

describe("history", () => {
  it("undoes and redoes changes", () => {
    const id = apply("Add", (d) => ops.addChild(d, d.rootId, { text: "A" }))!;
    apply("Text", (d) => ops.setText(d, id, "B"));
    expect(getState().doc.nodes[id].text).toBe("B");
    undo();
    expect(getState().doc.nodes[id].text).toBe("A");
    undo();
    expect(getState().doc.nodes[id]).toBeUndefined();
    redo();
    redo();
    expect(getState().doc.nodes[id].text).toBe("B");
  });

  it("a new change clears the redo stack", () => {
    apply("Add", (d) => ops.addChild(d, d.rootId, { text: "A" }));
    undo();
    apply("Add", (d) => ops.addChild(d, d.rootId, { text: "C" }));
    expect(getState().future).toHaveLength(0);
  });

  it("no-op changes are not recorded", () => {
    apply("Nothing", () => {});
    expect(getState().past).toHaveLength(0);
  });

  it("tracks dirty state across undo/redo and saves", () => {
    expect(isDirty()).toBe(false);
    apply("Add", (d) => ops.addChild(d, d.rootId, { text: "A" }));
    expect(isDirty()).toBe(true);
    markSaved("/tmp/x.meandrismap");
    expect(isDirty()).toBe(false);
    apply("Add", (d) => ops.addChild(d, d.rootId, { text: "B" }));
    expect(isDirty()).toBe(true);
    undo();
    expect(isDirty()).toBe(false);
    undo();
    expect(isDirty()).toBe(true);
    redo();
    expect(isDirty()).toBe(false);
  });

  it("documents loaded as dirty (e.g. recovered) stay dirty until saved", () => {
    loadDocument(createDocument("R"), null, true);
    expect(isDirty()).toBe(true);
    markSaved("/tmp/y.meandrismap");
    expect(isDirty()).toBe(false);
  });
});

describe("keyboard flow (scenario A)", () => {
  it("builds Sports > Football > Players/Teams/Referees + Basketball/Volleyball", () => {
    startEditing(root());
    updateDraft("Sports");
    editorTab(); // commit root, new child
    updateDraft("Football");
    editorTab(); // child of Football
    updateDraft("Players");
    editorEnter();
    updateDraft("Teams");
    editorEnter();
    updateDraft("Referees");
    editorEnter(); // new empty sibling
    editorShiftTab(); // outdent: now a top-level branch
    updateDraft("Basketball");
    editorEnter();
    updateDraft("Volleyball");
    commitEditing();

    const doc = getState().doc;
    expect(doc.nodes[root()].text).toBe("Sports");
    expect(texts(root())).toEqual(["Football", "Basketball", "Volleyball"]);
    const football = doc.nodes[root()].children[0];
    expect(texts(football)).toEqual(["Players", "Teams", "Referees"]);
    expect(ops.checkInvariants(doc)).toEqual([]);
  });

  it("an empty new node is discarded on Enter/Escape without leaving history behind", () => {
    const before = getState().past.length;
    addChildAndEdit(root());
    commitEditing();
    expect(getState().doc.nodes[root()].children).toHaveLength(0);
    expect(getState().past.length).toBe(before);
    expect(getState().selection).toEqual({ kind: "node", id: root() });
  });

  it("leaving with an arrow key keeps typed text and discards an empty new topic", () => {
    addChildAndEdit(root());
    updateDraft("rik");
    leaveEditor("down");
    expect(getState().editing).toBeNull();
    expect(texts(root())).toEqual(["rik"]);
    const before = getState().past.length;
    addSiblingAndEdit(getState().doc.nodes[root()].children[0]);
    leaveEditor("up");
    expect(texts(root())).toEqual(["rik"]);
    expect(getState().past.length).toBe(before);
  });

  it("Tab on an empty new sibling indents it under the previous sibling", () => {
    addChildAndEdit(root());
    updateDraft("A");
    editorEnter(); // empty sibling of A
    editorTab(); // becomes child of A
    updateDraft("A1");
    commitEditing();
    const a = getState().doc.nodes[root()].children[0];
    expect(texts(root())).toEqual(["A"]);
    expect(texts(a)).toEqual(["A1"]);
  });

  it("creating a node and typing its text is one undo step", () => {
    addChildAndEdit(root());
    updateDraft("Idea");
    commitEditing();
    expect(texts(root())).toEqual(["Idea"]);
    undo();
    expect(texts(root())).toEqual([]);
  });

  it("adding a sibling of the root adds a child", () => {
    addSiblingAndEdit(root());
    updateDraft("Child");
    commitEditing();
    expect(texts(root())).toEqual(["Child"]);
  });

  it("whitespace is trimmed and unchanged text records nothing", () => {
    addChildAndEdit(root());
    updateDraft("  Spaced  ");
    commitEditing();
    const id = getState().doc.nodes[root()].children[0];
    expect(getState().doc.nodes[id].text).toBe("Spaced");
    const n = getState().past.length;
    startEditing(id);
    commitEditing();
    expect(getState().past.length).toBe(n);
  });
});
