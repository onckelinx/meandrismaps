import { describe, expect, it } from "vitest";
import type { MapDocument } from "../document/model";
import * as ops from "../document/ops";
import { inAnchor, layoutMap, outAnchor, type MapLayout, type NodeLayout } from "./layout";
import type { MeasureWidth } from "./text";
import { wrapText } from "./text";

/** Deterministic fake: width proportional to characters and font size. */
const measure: MeasureWidth = (text, font) => {
  const size = Number(/(\d+(\.\d+)?)px/.exec(font)?.[1] ?? 14);
  return text.length * size * 0.55;
};

const lay = (doc: MapDocument) => layoutMap(doc, { measure });

function overlaps(a: NodeLayout, b: NodeLayout): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function assertNoOverlaps(layout: MapLayout) {
  const nodes = [...layout.nodes.values()];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (overlaps(nodes[i], nodes[j])) {
        throw new Error(`overlap: "${nodes[i].lines.join(" ")}" / "${nodes[j].lines.join(" ")}"`);
      }
    }
  }
}

function randomDoc(n: number, seed = 7): MapDocument {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const doc = ops.createDocument("Central topic");
  const ids = [doc.rootId];
  for (let i = 0; i < 5; i++) ids.push(ops.addChild(doc, doc.rootId, { text: `Branch ${i}` }));
  for (let i = 0; i < n; i++) {
    // Bias towards recent nodes for realistic depth.
    const parent = ids[Math.floor(Math.pow(rnd(), 0.6) * ids.length)];
    const words = Math.ceil(rnd() * 6);
    ids.push(ops.addChild(doc, parent, { text: Array.from({ length: words }, (_, k) => `word${k}`).join(" ") }));
  }
  return doc;
}

describe("layout", () => {
  it("centres the root at the origin", () => {
    const doc = ops.createDocument("Root");
    const l = lay(doc);
    const r = l.nodes.get(doc.rootId)!;
    expect(r.x + r.width / 2).toBeCloseTo(0);
    expect(r.y + r.height / 2).toBeCloseTo(0);
  });

  it("places right-side children to the right of their parent and left-side ones to the left", () => {
    const doc = randomDoc(60);
    const l = lay(doc);
    for (const n of l.nodes.values()) {
      if (!n.parentId) continue;
      const p = l.nodes.get(n.parentId)!;
      if (n.side === "right") expect(n.x).toBeGreaterThan(p.x + p.width - 1);
      else expect(n.x + n.width).toBeLessThan(p.x + 1);
    }
  });

  it.each([10, 100, 500, 1000])("has no overlapping nodes with %i nodes", (n) => {
    assertNoOverlaps(lay(randomDoc(n, n)));
  });

  it("keeps sibling order top to bottom", () => {
    const doc = randomDoc(80);
    const l = lay(doc);
    for (const id of l.order) {
      const kids = doc.nodes[id].children.map((c) => l.nodes.get(c)).filter(Boolean) as NodeLayout[];
      for (const side of ["left", "right"]) {
        const ys = kids.filter((k) => k.side === side).map((k) => k.y);
        expect([...ys].sort((a, b) => a - b)).toEqual(ys);
      }
    }
  });

  it("aligns a single child with its parent's branch line", () => {
    const doc = ops.createDocument("Root");
    const a = ops.addChild(doc, doc.rootId, { text: "A" });
    const b = ops.addChild(doc, a, { text: "B" });
    const l = lay(doc);
    expect(inAnchor(l.nodes.get(b)!).y).toBeCloseTo(outAnchor(l.nodes.get(a)!).y);
  });

  it("collapsing hides descendants and reclaims space (scenario C)", () => {
    const doc = randomDoc(40);
    const big = doc.nodes[doc.rootId].children.reduce((best, c) =>
      doc.nodes[c].children.length > doc.nodes[best].children.length ? c : best,
    );
    const before = lay(doc);
    ops.setCollapsed(doc, big, true);
    const after = lay(doc);
    for (const c of doc.nodes[big].children) expect(after.nodes.has(c)).toBe(false);
    expect(after.nodes.get(big)!.hiddenCount).toBeGreaterThan(0);
    expect(after.bounds.height).toBeLessThanOrEqual(before.bounds.height);
  });

  it("uses the live draft text of the node being edited", () => {
    const doc = ops.createDocument("Root");
    const a = ops.addChild(doc, doc.rootId, { text: "A" });
    const short = layoutMap(doc, { measure }).nodes.get(a)!.width;
    const long = layoutMap(doc, { measure, editing: { id: a, text: "A much longer label" } }).nodes.get(a)!.width;
    expect(long).toBeGreaterThan(short);
  });
});

describe("boundaries (scenario E)", () => {
  it("encloses the bounded node and its visible descendants, and grows with new children", () => {
    const doc = randomDoc(30);
    const target = doc.nodes[doc.rootId].children[0];
    ops.setBoundary(doc, target, {});
    let l = lay(doc);
    expect(l.boundaries).toHaveLength(1);
    const contains = (layout: MapLayout) => {
      const b = layout.boundaries[0].bounds;
      const stack = [target];
      while (stack.length) {
        const id = stack.pop()!;
        const n = layout.nodes.get(id);
        if (!n) continue;
        expect(n.x).toBeGreaterThanOrEqual(b.x);
        expect(n.y).toBeGreaterThanOrEqual(b.y);
        expect(n.x + n.width).toBeLessThanOrEqual(b.x + b.width);
        expect(n.y + n.height).toBeLessThanOrEqual(b.y + b.height);
        stack.push(...doc.nodes[id].children);
      }
    };
    contains(l);
    const before = l.boundaries[0].bounds.height;
    ops.addChild(doc, target, { text: "another child" });
    ops.addChild(doc, target, { text: "and another" });
    l = lay(doc);
    contains(l);
    expect(l.boundaries[0].bounds.height).toBeGreaterThan(before);
  });

  it("does not let nodes outside the boundary intrude", () => {
    const doc = randomDoc(60, 3);
    const target = doc.nodes[doc.rootId].children[1];
    ops.setBoundary(doc, target, {});
    const l = lay(doc);
    const b = l.boundaries[0].bounds;
    const inside = new Set<string>();
    const stack = [target];
    while (stack.length) {
      const id = stack.pop()!;
      inside.add(id);
      stack.push(...doc.nodes[id].children);
    }
    for (const n of l.nodes.values()) {
      if (inside.has(n.id) || n.id === doc.rootId) continue;
      const cy = n.y + n.height / 2;
      const cx = n.x + n.width / 2;
      const within = cx > b.x && cx < b.x + b.width && cy > b.y && cy < b.y + b.height;
      expect(within).toBe(false);
    }
  });
});

describe("text wrapping", () => {
  it("wraps at the width limit and keeps explicit newlines", () => {
    const lines = wrapText("one two three four five six", 60, "14px x", measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, "14px x")).toBeLessThanOrEqual(60);
    expect(wrapText("a\nb", 500, "14px x", measure)).toEqual(["a", "b"]);
  });

  it("breaks words longer than the limit", () => {
    const lines = wrapText("supercalifragilisticexpialidocious", 50, "14px x", measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("supercalifragilisticexpialidocious");
  });
});
