/** Everything the app needs from the desktop, behind one interface. */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface RecoveryEntry {
  id: string;
  modified: number;
}

export interface NativeMenuItem {
  id: string;
  label: string;
  /** Tauri accelerator syntax, e.g. "CmdOrCtrl+S". */
  accelerator?: string;
  action?: () => void;
  enabled?: boolean;
  checked?: boolean;
  items?: NativeMenuItem[];
  separator?: boolean;
  /** Use the platform's native implementation (macOS edit items). */
  predefined?: "cut" | "copy" | "paste" | "selectAll" | "quit" | "about" | "hide" | "hideOthers" | "showAll" | "minimize" | "fullscreen";
}

export interface Platform {
  kind: "tauri" | "browser";
  openDialog(filters: FileFilter[], title?: string): Promise<string | null>;
  saveDialog(defaultName: string, filters: FileFilter[], title?: string): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  /** Atomic write: either the whole file is replaced or nothing changes. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  recoveryWrite(id: string, bytes: Uint8Array): Promise<void>;
  recoveryList(): Promise<RecoveryEntry[]>;
  recoveryRead(id: string): Promise<Uint8Array>;
  /** Takes over an abandoned recovery slot so this instance keeps updating it. */
  recoveryClaim(id: string): Promise<void>;
  recoveryDelete(id: string): Promise<void>;
  setTitle(title: string): void;
  /** `handler` resolves to true when the window may close. */
  onCloseRequested(handler: () => Promise<boolean>): void;
  closeWindow(): Promise<void>;
  /** A map file passed on the command line, if any. */
  initialFile(): Promise<string | null>;
  /** Called when the OS asks the running app to open files (macOS Finder). */
  onOpenFiles(handler: (paths: string[]) => void): void;
  setMenu(menus: NativeMenuItem[]): Promise<void>;
  /** Shows the system print dialog for the current page's print styling. */
  print(): Promise<void>;
}

export function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/^browser-file:/, "");
}
