/** A small, keyboard-navigable context menu with optional colour swatches. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createStore, useStore } from "zustand";

export type MenuEntry =
  | { kind?: "item"; label: string; shortcut?: string; run: () => void; disabled?: boolean; danger?: boolean }
  | { kind: "separator" }
  | {
      kind: "swatches";
      label: string;
      colors: { value: string; name: string }[];
      selected?: string;
      onPick: (color: string) => void;
    };

interface MenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

const menuStore = createStore<{ menu: MenuState | null }>(() => ({ menu: null }));

export function openContextMenu(x: number, y: number, entries: MenuEntry[]) {
  menuStore.setState({ menu: { x, y, entries } });
}

export function closeContextMenu() {
  menuStore.setState({ menu: null });
}

function Menu({ menu }: { menu: MenuState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(6, Math.min(menu.x, window.innerWidth - r.width - 6)),
      top: Math.max(6, Math.min(menu.y, window.innerHeight - r.height - 6)),
    });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu();
    };
    const onBlur = () => closeContextMenu();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("wheel", onBlur, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("wheel", onBlur);
    };
  }, []);

  const activate = (fn: () => void) => {
    closeContextMenu();
    fn();
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      data-own-keys
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "Escape") {
          e.preventDefault();
          closeContextMenu();
        } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          buttons[(i + 1) % buttons.length]?.focus();
        } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
        }
      }}
    >
      {menu.entries.map((entry, i) => {
        if (entry.kind === "separator") return <div key={i} className="context-separator" role="separator" />;
        if (entry.kind === "swatches") {
          return (
            <div key={i} className="context-swatches" role="group" aria-label={entry.label}>
              <div className="context-label">{entry.label}</div>
              <div className="swatch-row">
                {entry.colors.map((c) => (
                  <button
                    key={c.value}
                    className={`swatch${entry.selected === c.value ? " selected" : ""}`}
                    style={{ background: c.value }}
                    title={c.name}
                    aria-label={c.name}
                    role="menuitemradio"
                    aria-checked={entry.selected === c.value}
                    onClick={() => activate(() => entry.onPick(c.value))}
                  />
                ))}
              </div>
            </div>
          );
        }
        return (
          <button
            key={i}
            role="menuitem"
            className={`context-item${entry.danger ? " danger" : ""}`}
            disabled={entry.disabled}
            onClick={() => activate(entry.run)}
          >
            <span>{entry.label}</span>
            {entry.shortcut && <span className="shortcut">{entry.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ContextMenuHost() {
  const menu = useStore(menuStore, (s) => s.menu);
  return menu ? <Menu key={`${menu.x},${menu.y}`} menu={menu} /> : null;
}
