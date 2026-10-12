/** Development-only handles for scripted smoke tests (never included in production builds). */
import { currentLayout } from "../canvas/MapCanvas";
import { viewStore } from "../canvas/viewport";
import * as ops from "../document/ops";
import * as actions from "../state/actions";
import * as store from "../state/store";
import { runCommand } from "./commands";

/** Screen position (client coordinates) of a topic, found by its text. */
function where(text: string, part: "center" | "top" | "bottom" | "right" = "center") {
  const n = [...(currentLayout?.nodes.values() ?? [])].find((n) => n.lines.join(" ") === text);
  if (!n) return null;
  const v = viewStore.getState();
  const canvas = document.querySelector(".canvas")!.getBoundingClientRect();
  const y = part === "top" ? n.y + 3 : part === "bottom" ? n.y + n.height - 2 : n.y + n.height / 2;
  const x = part === "right" ? n.x + n.width + 60 : n.x + n.width / 2;
  return { x: canvas.left + x * v.k + v.x, y: canvas.top + y * v.k + v.y };
}

function outline(id = store.getState().doc.rootId, depth = 0): string {
  const doc = store.getState().doc;
  const n = doc.nodes[id];
  return "  ".repeat(depth) + n.text + (n.collapsed ? " [+]" : "") + "\n" + n.children.map((c) => outline(c, depth + 1)).join("");
}

export function installDevHooks() {
  (window as unknown as Record<string, unknown>).__meandris = { ops, store, actions, runCommand, where, outline };
}
