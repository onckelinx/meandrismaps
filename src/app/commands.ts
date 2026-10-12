/**
 * Command registry: one place that defines what each command does, its
 * shortcut and when it is available. Used by the keyboard handler, the native
 * menu and context menus.
 */

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export interface AppCommand {
  id: string;
  label: string;
  /** Shortcuts like "Mod+Shift+Z", "Tab", "Alt+ArrowUp". Mod = Cmd on macOS, Ctrl elsewhere. */
  keys?: string[];
  run: () => void | Promise<void>;
  enabled?: () => boolean;
  /**
   * When true, the shortcut also fires while typing in a text field
   * (e.g. Save). Text-editing shortcuts (undo, copy...) are never global.
   */
  global?: boolean;
}

const registry = new Map<string, AppCommand>();

export function registerCommands(cmds: AppCommand[]) {
  for (const c of cmds) registry.set(c.id, c);
}

export function getCommand(id: string): AppCommand | undefined {
  return registry.get(id);
}

export function allCommands(): AppCommand[] {
  return [...registry.values()];
}

export function runCommand(id: string) {
  const c = registry.get(id);
  if (!c || (c.enabled && !c.enabled())) return;
  void c.run();
}

interface ParsedKey {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parse(spec: string): ParsedKey {
  const parts = spec.split("+");
  let key = parts.pop()!;
  if (key === "Space") key = " ";
  return {
    mod: parts.includes("Mod"),
    shift: parts.includes("Shift"),
    alt: parts.includes("Alt"),
    key: key.length === 1 ? key.toLowerCase() : key,
  };
}

export function matches(spec: string, e: KeyboardEvent): boolean {
  const p = parse(spec);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const otherMod = isMac ? e.ctrlKey : e.metaKey;
  if (p.mod !== mod || otherMod || p.alt !== e.altKey) return false;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // Shifted punctuation (e.g. "+" on "=") must not require an explicit Shift.
  if (p.key.length === 1 && !/[a-z0-9]/.test(p.key)) return key === p.key || (p.key === "=" && key === "+");
  if (p.shift !== e.shiftKey) return false;
  return key === p.key;
}

/** Finds the command for a key event, honouring `global` when focus is in a text field. */
export function commandForEvent(e: KeyboardEvent, inTextField: boolean): AppCommand | undefined {
  for (const c of registry.values()) {
    if (!c.keys) continue;
    if (inTextField && !c.global) continue;
    if (c.keys.some((k) => matches(k, e))) return c;
  }
  return undefined;
}

/** Human-readable shortcut for menus and docs. */
export function formatShortcut(spec: string): string {
  const p = parse(spec);
  const names: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    " ": "Space",
    Delete: isMac ? "⌦" : "Del",
    Backspace: isMac ? "⌫" : "Backspace",
    Enter: isMac ? "↩" : "Enter",
    Escape: "Esc",
  };
  const key = names[p.key] ?? (p.key.length === 1 ? p.key.toUpperCase() : p.key);
  if (isMac) return `${p.mod ? "⌘" : ""}${p.alt ? "⌥" : ""}${p.shift ? "⇧" : ""}${key}`;
  return [p.mod && "Ctrl", p.alt && "Alt", p.shift && "Shift", key].filter(Boolean).join("+");
}
