/** Context menus for topics, images and the empty canvas. */
import { formatShortcut, getCommand, runCommand } from "../app/commands";
import type { NodeId } from "../document/model";
import { PALETTE } from "../document/palette";
import { effectiveColor } from "../document/queries";
import { setBoundary, setBranchColor, startEditing } from "../state/actions";
import { getState, select } from "../state/store";
import type { MenuEntry } from "../ui/ContextMenu";

function item(id: string, label?: string, opts: { danger?: boolean; disabled?: boolean } = {}): MenuEntry[] {
  const c = getCommand(id);
  if (!c) return [];
  const key = c.keys?.[0];
  return [
    {
      label: label ?? c.label,
      shortcut: key ? formatShortcut(key) : undefined,
      run: () => runCommand(id),
      danger: opts.danger,
      disabled: opts.disabled ?? (c.enabled ? !c.enabled() : false),
    },
  ];
}

const sep: MenuEntry = { kind: "separator" };

export function nodeMenu(id: NodeId): MenuEntry[] {
  select({ kind: "node", id });
  const doc = getState().doc;
  const node = doc.nodes[id];
  const isRoot = id === doc.rootId;
  const entries: MenuEntry[] = [
    ...item("node.addChild", "Add Child"),
    ...(isRoot ? [] : item("node.addSibling", "Add Sibling")),
    { label: "Edit Text", shortcut: formatShortcut("F2"), run: () => startEditing(id, { selectAll: true }) },
    sep,
  ];
  if (!isRoot) {
    entries.push({
      kind: "swatches",
      label: "Branch color",
      colors: PALETTE,
      selected: effectiveColor(doc, id),
      onPick: (c) => setBranchColor(id, c),
    });
    if (node.color && node.parentId !== doc.rootId) {
      entries.push({ label: "Use Parent's Color", run: () => setBranchColor(id, undefined) });
    }
  }
  entries.push(...item("node.toggleBoundary", node.boundary ? "Remove Boundary" : "Add Boundary"));
  if (node.boundary) {
    entries.push({
      kind: "swatches",
      label: "Boundary color",
      colors: PALETTE,
      selected: node.boundary.fill ?? effectiveColor(doc, id),
      onPick: (c) => setBoundary(id, { fill: c, stroke: c }),
    });
  }
  entries.push(
    ...(node.children.length ? item("node.toggleCollapse", node.collapsed ? "Expand" : "Collapse") : []),
    sep,
    ...item("image.attach", "Attach Image…"),
    sep,
    ...(isRoot ? [] : item("edit.cut")),
    ...item("edit.copy"),
    ...item("edit.paste", "Paste as Child"),
    sep,
    ...(isRoot ? [] : item("node.delete", "Delete", { danger: true })),
  );
  return tidy(entries);
}

export function imageMenu(id: string): MenuEntry[] {
  select({ kind: "image", id });
  const img = getState().doc.images[id];
  return tidy([
    ...(img?.nodeId ? item("image.detach", "Detach from Topic") : item("image.attachNearest", "Attach to Nearest Topic")),
    ...item("image.resetSize", "Reset Size"),
    sep,
    ...item("node.delete", "Delete Image", { danger: true }),
  ]);
}

export function canvasMenu(): MenuEntry[] {
  return tidy([
    ...item("edit.paste"),
    ...item("image.insert", "Insert Image…"),
    sep,
    ...item("view.fit"),
    ...item("view.expandAll"),
    ...item("view.collapseAll"),
  ]);
}

function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if (e.kind === "separator" && (!out.length || out[out.length - 1].kind === "separator")) continue;
    out.push(e);
  }
  while (out.length && out[out.length - 1].kind === "separator") out.pop();
  return out;
}
