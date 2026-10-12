/** Commands for panels, menus and branch styling. */
import logoDark from "../assets/logo-dark.png";
import logo from "../assets/logo.png";
import { currentLayout } from "../canvas/MapCanvas";
import { nodeMenu } from "../canvas/contextMenus";
import { viewStore } from "../canvas/viewport";
import { PALETTE } from "../document/palette";
import { selectedNodeId, setBranchColor, toggleBoundary } from "../state/actions";
import { getState } from "../state/store";
import { openContextMenu } from "../ui/ContextMenu";
import { showDialog } from "../ui/dialogs";
import { openSearch } from "../ui/SearchBar";
import { openShortcuts } from "../ui/ShortcutsPanel";
import { registerCommands } from "./commands";

const notRoot = () => {
  const id = selectedNodeId();
  return id !== null && id !== getState().doc.rootId;
};

function openNodeMenuFromKeyboard() {
  const id = selectedNodeId();
  const n = id ? currentLayout?.nodes.get(id) : undefined;
  if (!id || !n) return;
  const v = viewStore.getState();
  const canvas = document.querySelector(".canvas")!.getBoundingClientRect();
  openContextMenu(canvas.left + (n.x + n.width) * v.k + v.x, canvas.top + (n.y + n.height) * v.k + v.y, nodeMenu(id));
}

registerCommands([
  { id: "edit.find", label: "Find…", keys: ["Mod+F"], global: true, run: openSearch },
  { id: "help.shortcuts", label: "Keyboard Shortcuts", keys: ["Mod+/", "F1"], global: true, run: openShortcuts },
  {
    id: "help.about",
    label: "About Meandris Maps",
    run: async () => {
      await showDialog({
        // The wordmark is dark navy; the dark theme gets a copy with white letters.
        image: document.documentElement.dataset.theme === "dark" ? logoDark : logo,
        className: "about",
        title: "Meandris Maps",
        message: `Version ${__APP_VERSION__}`,
        details: [
          "Fast, local-first mind maps",
          "© 2026 Rik Onckelinx - meandris.ai",
          "Free software under the GNU GPL v3 or later",
          "github.com/onckelinx/meandrismaps",
        ],
        buttons: [{ id: "ok", label: "OK", primary: true }],
        cancelId: "ok",
      });
    },
  },
  { id: "node.contextMenu", label: "Show Topic Menu", keys: ["Shift+F10", "ContextMenu"], run: openNodeMenuFromKeyboard },
  {
    id: "node.toggleBoundary",
    label: "Add/Remove Boundary",
    keys: ["Mod+B"],
    enabled: () => selectedNodeId() !== null,
    run: () => toggleBoundary(selectedNodeId()!),
  },
  ...PALETTE.map((c) => ({
    id: `color.${c.name.toLowerCase()}`,
    label: c.name,
    enabled: notRoot,
    run: () => setBranchColor(selectedNodeId()!, c.value),
  })),
  {
    id: "color.inherit",
    label: "Use Parent's Color",
    enabled: notRoot,
    run: () => setBranchColor(selectedNodeId()!, undefined),
  },
]);
