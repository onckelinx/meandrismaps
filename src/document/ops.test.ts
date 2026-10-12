import { describe, expect, it } from "vitest";
import type { MapDocument } from "./model";
import * as ops from "./ops";
import { PALETTE } from "./palette";
import { effectiveColor, isInSubtree, resolveTopLevelSides, visibleIds } from "./queries";

function sports(): { doc: MapDocument; ids: Record<string, string> } {
  const doc = ops.createDocument("Sports");
  const r = doc.rootId;
  const football = ops.addChild(doc, r, { text: "Football" });
  const players = ops.addChild(doc, football, { text: "Players" });
  const teams = ops.addChild(doc, football, { text: "Teams" });
  const referees = ops.addChild(doc, football, { text: "Referees" });
  const basketball = ops.addChild(doc, r, { text: "Basketball" });
  const volleyball = ops.addChild(doc, r, { text: "Volleyball" });
  return { doc, ids: { r, football, players, teams, referees, basketball, volleyball } };
}

const texts = (doc: MapDocument, id: string) => doc.nodes[id].children.map((c) => doc.nodes[c].text);

describe("tree operations", () => {
  it("builds a valid tree", () => {
    const { doc, ids } = sports();
    expect(ops.checkInvariants(doc)).toEqual([]);
    expect(texts(doc, ids.r)).toEqual(["Football", "Basketball", "Volleyball"]);
    expect(texts(doc, ids.football)).toEqual(["Players", "Teams", "Referees"]);
  });

  it("adds siblings after and before", () => {
    const { doc, ids } = sports();
    ops.addSibling(doc, ids.players, "after", { text: "Coaches" });
    ops.addSibling(doc, ids.players, "before", { text: "Fans" });
    expect(texts(doc, ids.football)).toEqual(["Fans", "Players", "Coaches", "Teams", "Referees"]);
  });

  it("adding a sibling to the root adds a child", () => {
    const { doc, ids } = sports();
    const id = ops.addSibling(doc, ids.r, "after", { text: "Tennis" });
    expect(doc.nodes[id].parentId).toBe(ids.r);
  });

  it("deletes a subtree and its attached images", () => {
    const { doc, ids } = sports();
    ops.addAsset(doc, { id: "a_1", mime: "image/png", width: 10, height: 10 });
    ops.addImage(doc, { id: "i_1", assetId: "a_1", nodeId: ids.players, x: 0, y: 0, width: 10, height: 10 });
    ops.addImage(doc, { id: "i_2", assetId: "a_1", x: 0, y: 0, width: 10, height: 10 });
    ops.deleteNode(doc, ids.football);
    expect(doc.nodes[ids.players]).toBeUndefined();
    expect(doc.images.i_1).toBeUndefined();
    expect(doc.images.i_2).toBeDefined();
    expect(ops.checkInvariants(doc)).toEqual([]);
  });

  it("refuses to delete the root", () => {
    const { doc, ids } = sports();
    expect(() => ops.deleteNode(doc, ids.r)).toThrow();
  });

  it("reparents (scenario B)", () => {
    const { doc, ids } = sports();
    ops.moveNode(doc, ids.referees, ids.basketball, 0);
    expect(texts(doc, ids.football)).toEqual(["Players", "Teams"]);
    expect(texts(doc, ids.basketball)).toEqual(["Referees"]);
    expect(doc.nodes[ids.referees].parentId).toBe(ids.basketball);
    expect(ops.checkInvariants(doc)).toEqual([]);
  });

  it("prevents moving a node into its own subtree", () => {
    const { doc, ids } = sports();
    expect(ops.canMove(doc, ids.football, ids.players)).toBe(false);
    expect(ops.canMove(doc, ids.football, ids.football)).toBe(false);
    expect(ops.canMove(doc, ids.r, ids.football)).toBe(false);
    expect(() => ops.moveNode(doc, ids.football, ids.players, 0)).toThrow();
  });

  it("reorders within the same parent using pre-move indices", () => {
    const { doc, ids } = sports();
    ops.moveNode(doc, ids.players, ids.football, 3); // to the end
    expect(texts(doc, ids.football)).toEqual(["Teams", "Referees", "Players"]);
    ops.moveNode(doc, ids.players, ids.football, 0);
    expect(texts(doc, ids.football)).toEqual(["Players", "Teams", "Referees"]);
    ops.reorder(doc, ids.players, 1);
    expect(texts(doc, ids.football)).toEqual(["Teams", "Players", "Referees"]);
  });

  it("outdents to just after the parent", () => {
    const { doc, ids } = sports();
    expect(ops.outdent(doc, ids.teams)).toBe(true);
    expect(texts(doc, ids.r)).toEqual(["Football", "Teams", "Basketball", "Volleyball"]);
    expect(ops.outdent(doc, ids.football)).toBe(false);
  });

  it("collapses only nodes with children and hides descendants", () => {
    const { doc, ids } = sports();
    ops.setCollapsed(doc, ids.volleyball, true);
    expect(doc.nodes[ids.volleyball].collapsed).toBe(false);
    ops.setCollapsed(doc, ids.football, true);
    expect(visibleIds(doc)).not.toContain(ids.players);
    expect(ops.reveal(doc, ids.players)).toBe(true);
    expect(visibleIds(doc)).toContain(ids.players);
  });

  it("adding a child expands a collapsed parent", () => {
    const { doc, ids } = sports();
    ops.setCollapsed(doc, ids.football, true);
    ops.addChild(doc, ids.football, { text: "Coaches" });
    expect(doc.nodes[ids.football].collapsed).toBe(false);
  });
});

describe("branch colours", () => {
  it("gives top-level branches distinct palette colours", () => {
    const { doc, ids } = sports();
    const cols = [ids.football, ids.basketball, ids.volleyball].map((id) => doc.nodes[id].color);
    expect(new Set(cols).size).toBe(3);
    for (const c of cols) expect(PALETTE.map((p) => p.value)).toContain(c);
  });

  it("descendants inherit, overrides apply to their subtree (scenario D)", () => {
    const { doc, ids } = sports();
    ops.setColor(doc, ids.football, "#123456");
    expect(effectiveColor(doc, ids.players)).toBe("#123456");
    ops.setColor(doc, ids.teams, "#abcdef");
    expect(effectiveColor(doc, ids.teams)).toBe("#abcdef");
    expect(effectiveColor(doc, ids.referees)).toBe("#123456");
    ops.setColor(doc, ids.teams, undefined);
    expect(effectiveColor(doc, ids.teams)).toBe("#123456");
  });

  it("a demoted top-level branch adopts its new branch colour", () => {
    const { doc, ids } = sports();
    ops.moveNode(doc, ids.volleyball, ids.football, 0);
    expect(effectiveColor(doc, ids.volleyball)).toBe(effectiveColor(doc, ids.football));
    ops.moveNode(doc, ids.volleyball, ids.r, 3);
    expect(doc.nodes[ids.volleyball].color).toBeDefined();
    expect(doc.nodes[ids.volleyball].side).toBeDefined();
  });
});

describe("sides", () => {
  it("balances new top-level branches", () => {
    const doc = ops.createDocument("Root");
    for (let i = 0; i < 6; i++) ops.addChild(doc, doc.rootId, { text: `B${i}` });
    const sides = [...resolveTopLevelSides(doc).values()];
    expect(sides.filter((s) => s === "left").length).toBe(3);
  });

  it("right-only layout puts everything on the right", () => {
    const doc = ops.createDocument("Root");
    ops.setLayoutMode(doc, "right");
    for (let i = 0; i < 4; i++) ops.addChild(doc, doc.rootId, { text: `B${i}` });
    expect([...resolveTopLevelSides(doc).values()].every((s) => s === "right")).toBe(true);
  });
});

describe("random operation sequences keep the tree valid", () => {
  it("survives 2000 random operations", () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const doc = ops.createDocument("Root");
    const pick = () => {
      const ids = Object.keys(doc.nodes);
      return ids[Math.floor(rnd() * ids.length)];
    };
    for (let i = 0; i < 2000; i++) {
      const id = pick();
      const r = rnd();
      if (r < 0.35) ops.addChild(doc, id, { text: `n${i}` });
      else if (r < 0.5) ops.addSibling(doc, id, rnd() < 0.5 ? "before" : "after", { text: `s${i}` });
      else if (r < 0.62 && id !== doc.rootId) ops.deleteNode(doc, id);
      else if (r < 0.8) {
        const target = pick();
        if (ops.canMove(doc, id, target)) ops.moveNode(doc, id, target, Math.floor(rnd() * 5));
      } else if (r < 0.88) ops.outdent(doc, id);
      else if (r < 0.95) ops.reorder(doc, id, rnd() < 0.5 ? -1 : 1);
      else ops.setCollapsed(doc, id, rnd() < 0.5);
      const errors = ops.checkInvariants(doc);
      if (errors.length) throw new Error(`after op ${i}: ${errors.join(", ")}`);
    }
    for (const id of Object.keys(doc.nodes)) expect(isInSubtree(doc, id, doc.rootId)).toBe(true);
  });
});
