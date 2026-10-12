/**
 * Markdown → map structure.
 *
 * Only hierarchy is extracted: headings and (nested) list items become topics.
 * Paragraphs, code, tables and the like are skipped and reported, never
 * silently mangled.
 */
import type { Heading, List, ListItem, Nodes, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { OutlineItem } from "../document/ops";

export interface MarkdownImport {
  /** The central topic and its branches. */
  root: OutlineItem;
  /** The top-level items as found (for pasting into an existing map). */
  items: OutlineItem[];
  warnings: string[];
}

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/^\[[ xX]\]\s+/, "")
    .trim();

function stripFrontMatter(text: string): string {
  return text.replace(/^﻿/, "").replace(/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n/, "");
}

export function importMarkdown(text: string, fallbackTitle = "Imported Map"): MarkdownImport {
  const tree: Root = fromMarkdown(stripFrontMatter(text));
  const top: OutlineItem[] = [];
  const stack: { depth: number; item: OutlineItem }[] = [];
  let skipped = 0;

  const container = () => (stack.length ? stack[stack.length - 1].item.children : top);

  function listItems(list: List, into: OutlineItem[]) {
    for (const li of list.children as ListItem[]) {
      let text = "";
      const children: OutlineItem[] = [];
      for (const child of li.children) {
        if (child.type === "paragraph" && !text) text = clean(toString(child));
        else if (child.type === "list") listItems(child, children);
        else skipped++;
      }
      if (text) into.push({ text, children });
      else into.push(...children); // an empty bullet: keep its sub-items
    }
  }

  for (const node of tree.children as RootContent[]) {
    if (node.type === "heading") {
      const h = node as Heading;
      const item: OutlineItem = { text: clean(toString(h as Nodes)), children: [] };
      while (stack.length && stack[stack.length - 1].depth >= h.depth) stack.pop();
      container().push(item);
      stack.push({ depth: h.depth, item });
    } else if (node.type === "list") {
      listItems(node as List, container());
    } else if (node.type !== "thematicBreak" && node.type !== "definition") {
      skipped++;
    }
  }

  // A single top-level item (normally the first heading) is the central topic.
  const root: OutlineItem = top.length === 1 ? top[0] : { text: fallbackTitle, children: top };

  const warnings: string[] = [];
  if (!top.length) warnings.push("No headings or lists were found, so the map only has a central topic.");
  if (skipped) {
    warnings.push(
      `${skipped} block${skipped === 1 ? "" : "s"} of text (paragraphs, code, tables…) ` +
        `${skipped === 1 ? "was" : "were"} skipped: only headings and lists become topics.`,
    );
  }
  return { root, items: top, warnings };
}
