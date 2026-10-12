/** Help → Keyboard Shortcuts: generated from the command registry. */
import { useEffect, useRef } from "react";
import { createStore, useStore } from "zustand";
import { formatShortcut, getCommand, isMac } from "../app/commands";

const panelStore = createStore<{ open: boolean }>(() => ({ open: false }));
export const openShortcuts = () => panelStore.setState({ open: true });
const close = () => panelStore.setState({ open: false });

const mod = isMac ? "⌘" : "Ctrl+";

const GROUPS: { title: string; rows: (string | [string, string])[] }[] = [
  {
    title: "Writing",
    rows: [
      "node.addChild",
      "node.addSibling",
      "node.addSiblingBefore",
      ["Finish typing", "Esc"],
      ["Finish and move to another topic", "Arrow at the edge of the text"],
      ["New line in a topic", isMac ? "⇧↩" : "Shift+Enter"],
      "node.edit",
      ["Edit (replace text)", "Just start typing"],
    ],
  },
  {
    title: "Structure",
    rows: ["node.outdent", "node.moveUp", "node.moveDown", "node.toggleCollapse", "node.delete", ["Move a branch", "Drag it"]],
  },
  {
    title: "Navigation",
    rows: [["Select nearby topic", "↑ ↓ ← →"], "nav.root", "edit.find", "view.fit", "view.actualSize", "view.zoomIn", "view.zoomOut"],
  },
  {
    title: "Document",
    rows: [
      "file.new",
      "file.open",
      "file.save",
      "file.saveAs",
      "edit.undo",
      "edit.redo",
      ["Copy / Cut / Paste branch", `${mod}C / ${mod}X / ${mod}V`],
      "file.print",
    ],
  },
];

export function ShortcutsPanel() {
  const open = useStore(panelStore, (s) => s.open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" data-own-keys onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={ref}
        tabIndex={-1}
        className="modal shortcuts"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || e.key === "Enter") {
            e.preventDefault();
            close();
          }
        }}
      >
        <h2>Keyboard Shortcuts</h2>
        <div className="shortcut-groups">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map((row) => {
                  let label: string;
                  let keys: string;
                  if (typeof row === "string") {
                    const c = getCommand(row);
                    if (!c?.keys?.length) return null;
                    label = c.label;
                    keys = c.keys.map(formatShortcut).join("  or  ");
                  } else [label, keys] = row;
                  return (
                    <div key={label} className="shortcut-row">
                      <dt>{label}</dt>
                      <dd>{keys}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>
        <div className="modal-buttons">
          <button className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
