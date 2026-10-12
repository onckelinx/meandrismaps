/**
 * Inline text editor: a textarea laid exactly over the node label, using the
 * same font metrics as the SVG text it temporarily replaces.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { NodeLayout } from "../layout/layout";
import { FONT_FAMILY } from "../layout/styles";
import type { MapTheme } from "../render/theme";
import { commitEditing, editorEnter, editorShiftTab, editorTab } from "../state/actions";
import { getState, updateDraft, type Editing } from "../state/store";
import { arrowExit, isArrowKey, leaveEditor } from "./editorKeys";
import { useViewport } from "./viewport";

export function NodeEditor({ node, editing, theme }: { node: NodeLayout; editing: Editing; theme: MapTheme }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const view = useViewport((v) => v);
  const { style } = node;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (editing.selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // Only on mount: each edited node gets a fresh editor (keyed by id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  });

  const k = view.k;
  const isRoot = style.shape === "bubble";
  return (
    <textarea
      ref={ref}
      className="node-editor"
      value={editing.draft}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      rows={1}
      style={{
        left: node.x * k + view.x,
        top: node.y * k + view.y,
        width: node.width * k + 2,
        height: node.height * k,
        padding: `${style.padTop * k}px ${style.padX * k}px ${style.padBottom * k}px`,
        fontFamily: FONT_FAMILY,
        fontWeight: style.fontWeight,
        fontSize: style.fontSize * k,
        lineHeight: String(style.lineHeight),
        textAlign: isRoot ? "center" : node.side === "left" ? "right" : "left",
        color: isRoot ? theme.rootText : theme.text,
        caretColor: theme.selection,
      }}
      onChange={(e) => updateDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
        if (plain && isArrowKey(e.key)) {
          const el = e.currentTarget;
          const dir = arrowExit(e.key, el.value, el.selectionStart, el.selectionEnd, node.lines);
          if (dir) {
            e.preventDefault();
            leaveEditor(dir);
          }
          return;
        }
        if (e.key === "Enter" && plain) {
          e.preventDefault();
          editorEnter();
        } else if (e.key === "Tab") {
          e.preventDefault();
          if (e.shiftKey) editorShiftTab();
          else editorTab();
        } else if (e.key === "Escape") {
          e.preventDefault();
          commitEditing();
        }
      }}
      onBlur={() => {
        // Ignore blurs caused by the editor moving to another node.
        if (getState().editing?.id === editing.id && !document.hasFocus()) return;
        if (getState().editing?.id === editing.id) commitEditing();
      }}
    />
  );
}
