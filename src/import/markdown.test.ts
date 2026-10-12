import { describe, expect, it } from "vitest";
import type { MapDocument } from "../document/model";
import * as ops from "../document/ops";
import { exportMarkdown } from "../export/markdown";
import { importMarkdown } from "./markdown";

const outline = (doc: MapDocument, id = doc.rootId): unknown => ({
  text: doc.nodes[id].text,
  children: doc.nodes[id].children.map((c) => outline(doc, c)),
});

describe("markdown import", () => {
  it("turns headings into a hierarchy (scenario H)", () => {
    const { root, warnings } = importMarkdown("# Sports\n## Football\n### Players\n### Teams\n## Basketball\n## Volleyball\n");
    expect(warnings).toEqual([]);
    expect(root).toEqual({
      text: "Sports",
      children: [
        { text: "Football", children: [{ text: "Players", children: [] }, { text: "Teams", children: [] }] },
        { text: "Basketball", children: [] },
        { text: "Volleyball", children: [] },
      ],
    });
  });

  it("reads nested bullet lists under headings", () => {
    const md = "# Sports\n\n- Football\n  - Players\n  - Teams\n  - Referees\n- Basketball\n- Volleyball\n";
    const { root } = importMarkdown(md);
    expect(root.text).toBe("Sports");
    expect(root.children.map((c) => c.text)).toEqual(["Football", "Basketball", "Volleyball"]);
    expect(root.children[0].children.map((c) => c.text)).toEqual(["Players", "Teams", "Referees"]);
  });

  it("handles skipped heading levels and a list-only document", () => {
    expect(importMarkdown("# A\n#### deep\n## B\n").root).toEqual({
      text: "A",
      children: [
        { text: "deep", children: [] },
        { text: "B", children: [] },
      ],
    });
    const list = importMarkdown("- One\n- Two\n  - Two.a\n", "Notes");
    expect(list.root.text).toBe("Notes");
    expect(list.root.children.map((c) => c.text)).toEqual(["One", "Two"]);
  });

  it("uses a fallback central topic when there are several top-level headings", () => {
    const { root } = importMarkdown("# First\n## a\n# Second\n", "My file");
    expect(root.text).toBe("My file");
    expect(root.children.map((c) => c.text)).toEqual(["First", "Second"]);
  });

  it("strips formatting, task boxes and front matter; reports skipped content", () => {
    const md = "---\ntitle: x\n---\n# **Bold** _idea_ [link](http://x)\n\nSome paragraph.\n\n```\ncode\n```\n\n- [ ] task one\n- [x] task two\n";
    const { root, warnings } = importMarkdown(md);
    expect(root.text).toBe("Bold idea link");
    expect(root.children.map((c) => c.text)).toEqual(["task one", "task two"]);
    expect(warnings.join(" ")).toMatch(/2 blocks of text/);
  });

  it("copes with empty and odd input", () => {
    expect(importMarkdown("", "Empty").root).toEqual({ text: "Empty", children: [] });
    expect(importMarkdown("just text", "T").warnings.length).toBeGreaterThan(0);
    expect(importMarkdown("#\n## child\n").root.children.map((c) => c.text)).toEqual(["child"]);
  });
});

describe("markdown export", () => {
  it("writes the brief's heading outline", () => {
    const doc = ops.documentFromOutline(
      importMarkdown("# Sports\n## Football\n### Players\n### Teams\n### Referees\n## Basketball\n## Volleyball\n").root,
    );
    expect(exportMarkdown(doc)).toBe(
      "# Sports\n\n## Football\n### Players\n### Teams\n### Referees\n\n## Basketball\n\n## Volleyball\n",
    );
  });

  it("uses nested lists below heading level 6", () => {
    const doc = ops.createDocument("L1");
    let id = doc.rootId;
    for (let i = 2; i <= 9; i++) id = ops.addChild(doc, id, { text: `L${i}` });
    const md = exportMarkdown(doc);
    expect(md).toContain("###### L6\n\n- L7\n  - L8\n    - L9\n");
  });

  it("round-trips structure and tricky text exactly", () => {
    const texts = [
      "C#",
      "Ends with #",
      "snake_case and *stars*",
      "[brackets] <tags> `code`",
      "- starts like a list",
      "1. numbered",
      "> quote-ish",
      "&amp; entity",
      "back\\slash",
      "multi\nline",
      "  padded  ",
      "Ünïcödé — ✓",
    ];
    const doc = ops.createDocument("Root topic");
    let deep = doc.rootId;
    for (const [i, t] of texts.entries()) {
      ops.addChild(doc, doc.rootId, { text: t });
      deep = ops.addChild(doc, deep, { text: `${t} ${i}` });
    }
    const back = ops.documentFromOutline(importMarkdown(exportMarkdown(doc)).root);
    const normalise = (o: unknown): unknown => JSON.parse(JSON.stringify(o).replace(/\\n/g, " ").replace(/ {2,}/g, " "));
    const trim = (o: { text: string; children: unknown[] }): unknown => ({
      text: o.text.replace(/\s+/g, " ").trim(),
      children: (o.children as { text: string; children: unknown[] }[]).map(trim),
    });
    expect(normalise(outline(back))).toEqual(normalise(trim(outline(doc) as { text: string; children: unknown[] })));
  });
});
