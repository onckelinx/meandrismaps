/**
 * Browser implementation, used for development and scripted smoke tests.
 * Files are picked with <input type=file> and "saved" as downloads.
 */
import type { Platform, RecoveryEntry } from "./types";

const files = new Map<string, Uint8Array>();
const PREFIX = "browser-file:";

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const REC = "meandrismaps.recovery.";

/** Lets dev hooks/tests inject a file as if the user had picked it. */
export function registerBrowserFile(name: string, bytes: Uint8Array): string {
  files.set(PREFIX + name, bytes);
  return PREFIX + name;
}

export const browserPlatform: Platform = {
  kind: "browser",

  async openDialog(filters) {
    const accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
    const file = await pickFile(accept);
    if (!file) return null;
    return registerBrowserFile(file.name, new Uint8Array(await file.arrayBuffer()));
  },

  async saveDialog(defaultName) {
    return PREFIX + defaultName;
  },

  async readFile(path) {
    const bytes = files.get(path);
    if (!bytes) throw new Error("File not found");
    return bytes;
  },

  async writeFile(path, bytes) {
    files.set(path, bytes);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
    a.download = path.slice(PREFIX.length);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  },

  async recoveryWrite(id, bytes) {
    try {
      localStorage.setItem(REC + id, JSON.stringify({ modified: Date.now(), data: toBase64(bytes) }));
    } catch {
      // Storage full or unavailable: recovery is best-effort in the browser.
    }
  },

  async recoveryList() {
    const out: RecoveryEntry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(REC)) continue;
      try {
        out.push({ id: key.slice(REC.length), modified: JSON.parse(localStorage.getItem(key)!).modified });
      } catch {
        // ignore malformed entries
      }
    }
    return out.sort((a, b) => b.modified - a.modified);
  },

  async recoveryRead(id) {
    const raw = localStorage.getItem(REC + id);
    if (!raw) throw new Error("Recovery data not found");
    return fromBase64(JSON.parse(raw).data);
  },

  async recoveryClaim() {
    // Single-tab development use: nothing to lock.
  },

  async recoveryDelete(id) {
    localStorage.removeItem(REC + id);
  },

  setTitle(title) {
    document.title = title;
  },

  onCloseRequested(handler) {
    window.addEventListener("beforeunload", (e) => {
      // Browsers only allow a generic prompt; ask for it when there are unsaved changes.
      void handler;
      if ((window as unknown as { __meandrisDirty?: boolean }).__meandrisDirty) e.preventDefault();
    });
  },

  async closeWindow() {
    window.close();
  },

  onOpenFiles() {
    // Not applicable in the browser.
  },

  async print() {
    window.print();
  },

  async initialFile() {
    return null;
  },

  async setMenu() {
    // No native menu in the browser; keyboard shortcuts still work.
  },
};
