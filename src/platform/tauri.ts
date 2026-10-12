/** Tauri implementation of the platform interface. */
import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem, Submenu, CheckMenuItem } from "@tauri-apps/api/menu";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { NativeMenuItem, Platform, RecoveryEntry } from "./types";

const toBytes = (v: unknown): Uint8Array =>
  v instanceof ArrayBuffer ? new Uint8Array(v) : v instanceof Uint8Array ? v : new Uint8Array(v as number[]);

type MenuEntry = MenuItem | Submenu | PredefinedMenuItem | CheckMenuItem;

async function buildItem(item: NativeMenuItem): Promise<MenuEntry> {
  if (item.separator) return PredefinedMenuItem.new({ item: "Separator" });
  if (item.predefined) {
    const map = {
      cut: "Cut",
      copy: "Copy",
      paste: "Paste",
      selectAll: "SelectAll",
      quit: "Quit",
      about: { About: null },
      hide: "Hide",
      hideOthers: "HideOthers",
      showAll: "ShowAll",
      minimize: "Minimize",
      fullscreen: "Fullscreen",
    } as const;
    return PredefinedMenuItem.new({ item: map[item.predefined] as never, text: item.label });
  }
  if (item.items) {
    const items = await Promise.all(item.items.map(buildItem));
    return Submenu.new({ id: item.id, text: item.label, items, enabled: item.enabled ?? true });
  }
  if (item.checked !== undefined) {
    return CheckMenuItem.new({
      id: item.id,
      text: item.label,
      checked: item.checked,
      accelerator: item.accelerator,
      enabled: item.enabled ?? true,
      action: () => item.action?.(),
    });
  }
  return MenuItem.new({
    id: item.id,
    text: item.label,
    accelerator: item.accelerator,
    enabled: item.enabled ?? true,
    action: () => item.action?.(),
  });
}

let currentMenu: Menu | null = null;

export const tauriPlatform: Platform = {
  kind: "tauri",

  async openDialog(filters, title) {
    const result = await open({ multiple: false, directory: false, filters, title });
    return typeof result === "string" ? result : null;
  },

  async saveDialog(defaultName, filters, title) {
    return (await save({ defaultPath: defaultName, filters, title })) ?? null;
  },

  async readFile(path) {
    return toBytes(await invoke("read_file", { path }));
  },

  async writeFile(path, bytes) {
    await invoke("write_file_atomic", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  },

  async recoveryWrite(id, bytes) {
    await invoke("recovery_write", bytes, { headers: { "x-id": encodeURIComponent(id) } });
  },

  async recoveryList() {
    return invoke<RecoveryEntry[]>("recovery_list");
  },

  async recoveryRead(id) {
    return toBytes(await invoke("recovery_read", { id }));
  },

  async recoveryClaim(id) {
    await invoke("recovery_claim", { id });
  },

  async recoveryDelete(id) {
    await invoke("recovery_delete", { id });
  },

  setTitle(title) {
    void getCurrentWindow().setTitle(title);
  },

  onCloseRequested(handler) {
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (await handler()) await getCurrentWindow().destroy();
    });
  },

  async closeWindow() {
    await getCurrentWindow().close();
  },

  onOpenFiles(handler) {
    void listen("open-files", async () => {
      const paths = await invoke<string[]>("take_pending_files");
      if (paths.length) handler(paths);
    });
  },

  async print() {
    await invoke("print_window");
  },

  async initialFile() {
    return (await invoke<string | null>("initial_file")) ?? null;
  },

  async setMenu(menus) {
    const items = await Promise.all(menus.map(buildItem));
    const menu = await Menu.new({ items });
    await menu.setAsAppMenu();
    const old = currentMenu;
    currentMenu = menu;
    if (old) void old.close();
  },
};
