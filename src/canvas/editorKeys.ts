/**
 * Arrow keys while typing in a topic: they move the text cursor, but at the
 * edge of the text they finish the topic and move to another one instead.
 */
import { runCommand } from "../app/commands";
import { commitEditing } from "../state/actions";
import type { Direction } from "./navigation";

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Index of the wrapped line containing `caret`. `lines` are the rendered (wrapped) lines of `text`. */
export function caretLine(text: string, lines: string[], caret: number): number {
  let from = 0;
  let line = 0;
  for (let i = 0; i < lines.length; i++) {
    // Wrapping trims whitespace at breaks, so find each line's real start in the text.
    const start = lines[i] ? text.indexOf(lines[i], from) : from;
    if (start < 0) break;
    if (start > caret) break;
    line = i;
    from = start + lines[i].length;
  }
  return line;
}

/**
 * The direction to leave the editor in, or null when the key should just move
 * the cursor (not at the edge, text selected, or not an arrow).
 */
export function arrowExit(
  key: string,
  text: string,
  selStart: number,
  selEnd: number,
  lines: string[],
): Direction | null {
  const dir = ARROWS[key];
  if (!dir || selStart !== selEnd) return null;
  switch (dir) {
    case "left":
      return selStart === 0 ? dir : null;
    case "right":
      return selStart === text.length ? dir : null;
    case "up":
      return caretLine(text, lines, selStart) === 0 ? dir : null;
    case "down":
      return caretLine(text, lines, selStart) >= Math.max(0, lines.length - 1) ? dir : null;
  }
}

export function isArrowKey(key: string): boolean {
  return key in ARROWS;
}

export function arrowDirection(key: string): Direction | null {
  return ARROWS[key] ?? null;
}

/** Finishes typing and selects the neighbouring topic in `dir`. */
export function leaveEditor(dir: Direction) {
  // A new topic left empty is discarded and the previous selection restored: stay there.
  const id = commitEditing();
  if (id) runCommand(`nav.${dir}`);
}
