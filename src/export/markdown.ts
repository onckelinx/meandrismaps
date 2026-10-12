/**
 * Map → Markdown outline. The central topic is `#`, its branches `##`, and so
 * on down to `######`; anything deeper becomes nested bullet lists. Visual
 * styling (colours, images, boundaries) is not part of Markdown and is left
 * out — the .meandrismap file is the lossless format.
 */
import type { MapDocument, NodeId } from "../document/model";

/** Escapes text so that importing it again yields exactly the same string. */
export function escapeInline(text: string): string {
  return text
    .replace(/\s*\n\s*/g, " ")
    .replace(/[\\`*_[\]<]/g, (c) => `\\${c}`)
    .replace(/&(?=#?[a-z0-9]+;)/gi, "\\&");
}

function escapeHeading(text: string): string {
  // A trailing run of # would be read as a closing sequence.
  return escapeInline(text).replace(/(\s)(#+)\s*$/, (_m, ws, hashes) => `${ws}\\${hashes}`);
}

function escapeListItem(text: string): string {
  return escapeInline(text)
    .replace(/^([-+*>#])/, "\\$1")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

export function exportMarkdown(doc: MapDocument): string {
  const lines: string[] = [];
  let lastWasList = false;

  const walk = (id: NodeId, depth: number) => {
    const node = doc.nodes[id];
    const text = node.text.trim() || "Untitled";
    if (depth < 6) {
      const level = depth + 1;
      // Blank lines around top-level sections and lists, compact deeper headings.
      if (lines.length && (level <= 2 || lastWasList)) lines.push("");
      lines.push(`${"#".repeat(level)} ${escapeHeading(text)}`);
      if (level === 1 && node.children.length) lines.push("");
      lastWasList = false;
    } else {
      if (!lastWasList && lines.length) lines.push("");
      lines.push(`${"  ".repeat(depth - 6)}- ${escapeListItem(text)}`);
      lastWasList = true;
    }
    for (const c of node.children) walk(c, depth + 1);
  };

  walk(doc.rootId, 0);
  // Collapse accidental double blank lines.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
