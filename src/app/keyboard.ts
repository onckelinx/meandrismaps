/** Global keyboard handling for selection mode (the inline editor handles its own keys). */
import { commitEditing, editorEnter, editorShiftTab, editorTab, selectedNodeId, startEditing } from "../state/actions";
import { arrowDirection, leaveEditor } from "../canvas/editorKeys";
import { getState, updateDraft } from "../state/store";
import { commandForEvent } from "./commands";

function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * The inline editor is opening but does not have focus yet: route editing
 * keys to it so fast typing never loses a character. Returns true if handled.
 */
function routeToPendingEditor(e: KeyboardEvent): boolean {
  const editing = getState().editing;
  if (!editing || e.ctrlKey || e.metaKey) return false;
  const dir = e.shiftKey || e.altKey ? null : arrowDirection(e.key);
  if (e.key.length === 1 && !e.altKey) updateDraft(editing.draft + e.key);
  // The cursor is at the end of the draft: every arrow but ← leaves (← too when empty).
  else if (dir) {
    if (dir !== "left" || editing.draft === "") leaveEditor(dir);
  } else if (e.key === "Enter" && !e.shiftKey) editorEnter();
  else if (e.key === "Tab") (e.shiftKey ? editorShiftTab : editorTab)();
  else if (e.key === "Escape") commitEditing();
  else return false;
  e.preventDefault();
  return true;
}

export function installKeyboard(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    const inText = isTextField(e.target);
    // Modal dialogs and menus manage their own keys.
    if (!inText && (e.target as HTMLElement)?.closest?.("[data-own-keys]")) return;
    if (!inText && routeToPendingEditor(e)) return;
    const cmd = commandForEvent(e, inText);
    if (cmd) {
      e.preventDefault();
      if (!cmd.enabled || cmd.enabled()) void cmd.run();
      return;
    }
    if (inText) return;
    // Typing a character on a selected node starts editing it, replacing its text.
    if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const id = selectedNodeId();
      if (id) {
        e.preventDefault();
        startEditing(id, { draft: e.key });
      }
    }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
