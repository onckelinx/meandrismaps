/** Commands that operate on the map (editing, navigation, view). */
import { currentLayout } from "../canvas/MapCanvas";
import { navigate, type Direction } from "../canvas/navigation";
import { fitRect, resetZoom, zoomStep } from "../canvas/viewport";
import {
  addChildAndEdit,
  addSiblingAndEdit,
  commitEditing,
  deleteSelection,
  outdentSelected,
  reorderSelected,
  selectedNodeId,
  setAllCollapsed,
  startEditing,
  toggleCollapse,
} from "../state/actions";
import { getState, redo, select, undo } from "../state/store";
import { isMac, registerCommands, type AppCommand } from "./commands";

const hasNode = () => selectedNodeId() !== null;
const notRoot = () => {
  const id = selectedNodeId();
  return id !== null && id !== getState().doc.rootId;
};

function go(dir: Direction) {
  const s = getState();
  const id = selectedNodeId();
  if (!id || !currentLayout) {
    select({ kind: "node", id: s.doc.rootId });
    return;
  }
  const next = navigate(s.doc, currentLayout, id, dir);
  if (next) select({ kind: "node", id: next });
}

export function fitMap(animated = true, maxZoom?: number) {
  if (currentLayout) fitRect(currentLayout.bounds, { animated, maxZoom });
}

export const mapCommands: AppCommand[] = [
  { id: "node.addChild", label: "Add Child", keys: ["Tab"], enabled: hasNode, run: () => addChildAndEdit(selectedNodeId()!) },
  { id: "node.addSibling", label: "Add Sibling", keys: ["Enter"], enabled: hasNode, run: () => addSiblingAndEdit(selectedNodeId()!) },
  {
    id: "node.addSiblingBefore",
    label: "Add Sibling Before",
    keys: ["Shift+Enter"],
    enabled: hasNode,
    run: () => addSiblingAndEdit(selectedNodeId()!, "before"),
  },
  { id: "node.edit", label: "Edit Text", keys: ["F2"], enabled: hasNode, run: () => startEditing(selectedNodeId()!, { selectAll: true }) },
  {
    id: "node.delete",
    label: "Delete",
    keys: ["Delete", "Backspace"],
    enabled: () => notRoot() || getState().selection?.kind === "image",
    run: deleteSelection,
  },
  { id: "node.toggleCollapse", label: "Collapse/Expand", keys: ["Space"], enabled: hasNode, run: () => toggleCollapse(selectedNodeId()!) },
  { id: "node.outdent", label: "Move Up a Level", keys: ["Shift+Tab"], enabled: notRoot, run: outdentSelected },
  { id: "node.moveUp", label: "Move Up", keys: ["Alt+ArrowUp"], enabled: notRoot, run: () => reorderSelected(-1) },
  { id: "node.moveDown", label: "Move Down", keys: ["Alt+ArrowDown"], enabled: notRoot, run: () => reorderSelected(1) },
  { id: "nav.up", label: "Select Above", keys: ["ArrowUp"], run: () => go("up") },
  { id: "nav.down", label: "Select Below", keys: ["ArrowDown"], run: () => go("down") },
  { id: "nav.left", label: "Select Left", keys: ["ArrowLeft"], run: () => go("left") },
  { id: "nav.right", label: "Select Right", keys: ["ArrowRight"], run: () => go("right") },
  { id: "nav.root", label: "Select Central Topic", keys: ["Home"], run: () => select({ kind: "node", id: getState().doc.rootId }) },
  {
    id: "edit.undo",
    label: "Undo",
    keys: ["Mod+Z"],
    enabled: () => getState().past.length > 0 || !!getState().editing,
    run: () => {
      commitEditing();
      undo();
    },
  },
  {
    id: "edit.redo",
    label: "Redo",
    keys: isMac ? ["Mod+Shift+Z"] : ["Mod+Shift+Z", "Mod+Y"],
    enabled: () => getState().future.length > 0,
    run: redo,
  },
  { id: "view.zoomIn", label: "Zoom In", keys: ["Mod+="], global: true, run: () => zoomStep(1) },
  { id: "view.zoomOut", label: "Zoom Out", keys: ["Mod+-"], global: true, run: () => zoomStep(-1) },
  { id: "view.actualSize", label: "Actual Size", keys: ["Mod+0"], global: true, run: resetZoom },
  { id: "view.fit", label: "Fit Map to View", keys: ["Mod+1"], global: true, run: () => fitMap() },
  { id: "view.collapseAll", label: "Collapse All", run: () => setAllCollapsed(true) },
  { id: "view.expandAll", label: "Expand All", run: () => setAllCollapsed(false) },
];

registerCommands(mapCommands);
