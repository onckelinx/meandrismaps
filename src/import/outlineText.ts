/**
 * Plain-text outlines (indented lines, optionally bulleted), as produced by
 * most outliners and note apps when copying. Used for paste.
 */
import type { OutlineItem } from "../document/ops";

const BULLET = /^(?:[-*+•◦▪‣]|\d+[.)])\s+/;
const CHECKBOX = /^\[[ xX]\]\s+/;

export function cleanItemText(text: string): string {
  return text.replace(BULLET, "").replace(CHECKBOX, "").trim();
}

export function parseOutlineText(text: string): OutlineItem[] {
  const roots: OutlineItem[] = [];
  const stack: { indent: number; item: OutlineItem }[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) continue;
    const ws = /^[ \t]*/.exec(raw)![0];
    const indent = [...ws].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);
    const item: OutlineItem = { text: cleanItemText(raw.slice(ws.length)), children: [] };
    if (!item.text) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].item.children.push(item);
    else roots.push(item);
    stack.push({ indent, item });
  }
  return roots;
}

/** Indented bulleted text for copying a branch to other apps. */
export function outlineToText(items: OutlineItem[], depth = 0): string {
  return items
    .map((i) => `${"  ".repeat(depth)}- ${i.text.replace(/\n/g, " ")}\n${outlineToText(i.children, depth + 1)}`)
    .join("");
}
