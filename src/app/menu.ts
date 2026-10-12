/**
 * The native menu bar, generated from the command registry.
 *
 * Accelerators are only attached to modifier shortcuts that never conflict with
 * typing. Native menus intercept keys before the webview, so plain keys (Tab,
 * Enter, Delete...) and, on Linux and Windows, the text-editing shortcuts (Ctrl+Z/X/C/V/A)
 * are left to the in-app keyboard handler where they can act on text fields.
 */
import { baseName, platform, type NativeMenuItem } from "../platform";
import { editorStore } from "../state/store";
import { allCommands, getCommand, isMac, runCommand } from "./commands";
import { clearRecent, openPath, recentStore } from "./session";
import { themeStore } from "./useTheme";

const TEXT_KEYS = new Set(["Mod+Z", "Mod+Shift+Z", "Mod+Y", "Mod+X", "Mod+C", "Mod+V", "Mod+A"]);

function accelerator(id: string): string | undefined {
  const keys = getCommand(id)?.keys ?? [];
  const spec = keys.find((k) => k.startsWith("Mod+") && (isMac || !TEXT_KEYS.has(k)));
  return spec?.replace(/^Mod\+/, "CmdOrCtrl+");
}

/** Runs a command, but lets text fields handle undo/redo while one is focused. */
function runFromMenu(id: string) {
  const el = document.activeElement as HTMLElement | null;
  const inText = el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");
  if (inText && (id === "edit.undo" || id === "edit.redo")) {
    document.execCommand(id === "edit.undo" ? "undo" : "redo");
    return;
  }
  runCommand(id);
}

let uid = 0;
/** Native menu ids must be unique even when a command appears in two menus. */
const nextId = (base: string) => `${base}#${++uid}`;

function cmd(id: string, label?: string): NativeMenuItem[] {
  const c = getCommand(id);
  if (!c) return [];
  return [{ id: nextId(id), label: label ?? c.label, accelerator: accelerator(id), action: () => runFromMenu(id) }];
}

const sep = (): NativeMenuItem => ({ id: nextId("sep"), label: "", separator: true });

/** Removes separators at the ends and doubled separators (from missing commands). */
function tidy(items: NativeMenuItem[]): NativeMenuItem[] {
  const out: NativeMenuItem[] = [];
  for (const it of items) {
    if (it.separator && (out.length === 0 || out[out.length - 1].separator)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

function submenu(id: string, label: string, items: NativeMenuItem[]): NativeMenuItem[] {
  const t = tidy(items);
  return t.length ? [{ id, label, items: t }] : [];
}

function buildMenu(): NativeMenuItem[] {
  const recent = recentStore.getState().recent;
  const layout = editorStore.getState().doc.settings.layout;
  const theme = themeStore.getState().preference;
  const exportItems = allCommands().filter((c) => c.id.startsWith("export."));

  const menus: NativeMenuItem[] = [];
  if (isMac) {
    menus.push({
      id: "app",
      label: "Meandris Maps",
      items: [
        ...cmd("help.about", "About Meandris Maps"),
        sep(),
        { id: "hide", label: "Hide Meandris Maps", predefined: "hide" },
        { id: "hideOthers", label: "Hide Others", predefined: "hideOthers" },
        { id: "showAll", label: "Show All", predefined: "showAll" },
        sep(),
        // Not the predefined Quit: that exits without asking about unsaved changes.
        ...cmd("app.quit", "Quit Meandris Maps"),
      ],
    });
  }

  menus.push(
    ...submenu("file", "File", [
      ...cmd("file.new"),
      ...cmd("file.open"),
      ...submenu("recent", "Open Recent", [
        ...recent.map((p, i) => ({ id: `recent_${i}`, label: baseName(p), action: () => void openPath(p) })),
        sep(),
        ...(recent.length ? [{ id: "recentClear", label: "Clear Menu", action: clearRecent }] : []),
      ]),
      sep(),
      ...cmd("file.save"),
      ...cmd("file.saveAs"),
      sep(),
      ...cmd("import.markdown"),
      ...submenu(
        "export",
        "Export",
        exportItems.map((c) => ({ id: nextId(c.id), label: c.label, action: () => runCommand(c.id) })),
      ),
      sep(),
      ...cmd("file.print"),
      sep(),
      ...cmd("file.close"),
      ...(isMac ? [] : cmd("app.quit")),
    ]),
    ...submenu("edit", "Edit", [
      ...cmd("edit.undo"),
      ...cmd("edit.redo"),
      sep(),
      ...(isMac
        ? ([
            { id: "cut", label: "Cut", predefined: "cut" },
            { id: "copy", label: "Copy", predefined: "copy" },
            { id: "paste", label: "Paste", predefined: "paste" },
            { id: "selectAll", label: "Select All", predefined: "selectAll" },
          ] as NativeMenuItem[])
        : [...cmd("edit.cut"), ...cmd("edit.copy"), ...cmd("edit.paste")]),
      sep(),
      ...cmd("node.delete"),
      sep(),
      ...cmd("edit.find"),
    ]),
    ...submenu("insert", "Insert", [
      ...cmd("node.addChild", "Child Topic"),
      ...cmd("node.addSibling", "Sibling Topic"),
      sep(),
      ...cmd("image.insert"),
      ...cmd("image.attach"),
      sep(),
      ...cmd("node.toggleBoundary"),
    ]),
    ...submenu("format", "Branch", [
      ...submenu(
        "color",
        "Branch Color",
        allCommands()
          .filter((c) => c.id.startsWith("color."))
          .map((c) => ({ id: nextId(c.id), label: c.label, action: () => runCommand(c.id) })),
      ),
      ...cmd("node.toggleBoundary"),
      sep(),
      ...cmd("node.toggleCollapse"),
      ...cmd("node.moveUp"),
      ...cmd("node.moveDown"),
      ...cmd("node.outdent"),
    ]),
    ...submenu("view", "View", [
      ...cmd("view.zoomIn"),
      ...cmd("view.zoomOut"),
      ...cmd("view.actualSize"),
      ...cmd("view.fit"),
      sep(),
      ...cmd("view.collapseAll"),
      ...cmd("view.expandAll"),
      sep(),
      ...submenu("layout", "Layout", [
        { id: "view.layoutBoth", label: "Branches on Both Sides", checked: layout === "both", action: () => runCommand("view.layoutBoth") },
        { id: "view.layoutRight", label: "Branches to the Right", checked: layout === "right", action: () => runCommand("view.layoutRight") },
      ]),
      ...submenu("theme", "Appearance", [
        { id: "view.themeSystem", label: "Use System Setting", checked: theme === "system", action: () => runCommand("view.themeSystem") },
        { id: "view.themeLight", label: "Light", checked: theme === "light", action: () => runCommand("view.themeLight") },
        { id: "view.themeDark", label: "Dark", checked: theme === "dark", action: () => runCommand("view.themeDark") },
      ]),
    ]),
    ...submenu("help", "Help", [...cmd("help.shortcuts"), ...(isMac ? [] : cmd("help.about", "About Meandris Maps"))]),
  );
  return menus;
}

let pending = false;
function rebuild() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    void platform.setMenu(buildMenu()).catch((e) => console.error("menu", e));
  });
}

export function installMenu(): () => void {
  rebuild();
  let lastLayout = editorStore.getState().doc.settings.layout;
  const unsubs = [
    recentStore.subscribe(rebuild),
    themeStore.subscribe(rebuild),
    editorStore.subscribe((s) => {
      if (s.doc.settings.layout !== lastLayout) {
        lastLayout = s.doc.settings.layout;
        rebuild();
      }
    }),
  ];
  return () => unsubs.forEach((u) => u());
}
