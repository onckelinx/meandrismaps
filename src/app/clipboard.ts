/**
 * Copy / cut / paste of branches.
 *
 * Uses the native clipboard events so the platform's own shortcuts work and
 * text fields keep their normal behaviour. Branches are written both as an
 * indented text outline (for other apps) and as JSON (lossless within the app).
 */
import type { Boundary, MapDocument, NodeId } from "../document/model";
import * as ops from "../document/ops";
import { importMarkdown } from "../import/markdown";
import { parseOutlineText, outlineToText } from "../import/outlineText";
import { selectedNodeId } from "../state/actions";
import { apply, getState, select } from "../state/store";
import { registerCommands } from "./commands";

const MIME = "application/x-meandris-branch";

interface ClipNode {
  text: string;
  color?: string;
  boundary?: Boundary;
  collapsed?: boolean;
  children: ClipNode[];
}

function toClip(doc: MapDocument, id: NodeId): ClipNode {
  const n = doc.nodes[id];
  const c: ClipNode = { text: n.text, children: n.children.map((k) => toClip(doc, k)) };
  // A top-level colour is an identity on the root; elsewhere it is an override worth keeping.
  if (n.color && n.parentId !== doc.rootId) c.color = n.color;
  if (n.boundary) c.boundary = { ...n.boundary };
  if (n.collapsed) c.collapsed = true;
  return c;
}

function insertClip(doc: MapDocument, parentId: NodeId, items: ClipNode[], index?: number): NodeId[] {
  const ids: NodeId[] = [];
  let at = index ?? doc.nodes[parentId].children.length;
  for (const item of items) {
    const id = ops.addChild(doc, parentId, { text: item.text, index: at++ });
    if (item.color) doc.nodes[id].color = item.color;
    if (item.boundary) doc.nodes[id].boundary = { ...item.boundary };
    insertClip(doc, id, item.children);
    if (item.collapsed && item.children.length) doc.nodes[id].collapsed = true;
    ids.push(id);
  }
  return ids;
}

function isTextField(el: Element | null): boolean {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
}

/** Pasted images are handled by the image module (registered later). */
let imagePasteHandler: ((files: File[]) => void) | null = null;
export function setImagePasteHandler(fn: (files: File[]) => void) {
  imagePasteHandler = fn;
}

function onCopy(e: ClipboardEvent, cut: boolean) {
  if (isTextField(document.activeElement) || !e.clipboardData) return;
  const id = selectedNodeId();
  if (!id) return;
  const doc = getState().doc;
  e.preventDefault();
  const clip = toClip(doc, id);
  e.clipboardData.setData("text/plain", outlineToText([ops.toOutline(doc, id)]).trimEnd());
  try {
    e.clipboardData.setData(MIME, JSON.stringify(clip));
  } catch {
    // Some platforms reject custom types; plain text still works.
  }
  if (cut && id !== doc.rootId) {
    const parent = doc.nodes[id].parentId!;
    apply("Cut", (d) => ops.deleteNode(d, id), { select: { kind: "node", id: parent } });
  }
}

/** Inserts clipboard content under the selected topic. Returns true if anything was pasted. */
export function pasteData(data: DataTransfer): boolean {
  const files = [...data.files].filter((f) => f.type.startsWith("image/"));
  if (files.length && imagePasteHandler) {
    imagePasteHandler(files);
    return true;
  }
  const parent = selectedNodeId() ?? getState().doc.rootId;
  let items: ClipNode[] | null = null;
  const json = data.getData(MIME);
  if (json) {
    try {
      items = [JSON.parse(json) as ClipNode];
    } catch {
      items = null;
    }
  }
  if (!items) {
    const text = data.getData("text/plain");
    if (!text.trim()) return false;
    // Markdown with headings keeps its heading hierarchy; anything else is an indented outline.
    items = /^#{1,6}\s/m.test(text) ? importMarkdown(text).items : parseOutlineText(text);
  }
  if (!items.length) return false;
  const ids = apply("Paste", (d) => insertClip(d, parent, items!));
  if (ids?.length) select({ kind: "node", id: ids[0] });
  return true;
}

export function installClipboard(): () => void {
  const copy = (e: ClipboardEvent) => onCopy(e, false);
  const cut = (e: ClipboardEvent) => onCopy(e, true);
  const paste = (e: ClipboardEvent) => {
    if (isTextField(document.activeElement) || !e.clipboardData) return;
    if (pasteData(e.clipboardData)) e.preventDefault();
  };
  document.addEventListener("copy", copy);
  document.addEventListener("cut", cut);
  document.addEventListener("paste", paste);
  return () => {
    document.removeEventListener("copy", copy);
    document.removeEventListener("cut", cut);
    document.removeEventListener("paste", paste);
  };
}

// Menu items trigger the same native events. No `keys`: the platform's own
// Ctrl/Cmd+C/X/V must reach the webview untouched.
registerCommands([
  { id: "edit.cut", label: "Cut", run: () => void document.execCommand("cut") },
  { id: "edit.copy", label: "Copy", run: () => void document.execCommand("copy") },
  { id: "edit.paste", label: "Paste", run: () => void document.execCommand("paste") },
]);
