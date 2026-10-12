/**
 * Find (Cmd/Ctrl+F). Highlights matching topics; Enter / Shift+Enter step
 * through them. A match inside a collapsed branch is revealed (as an undoable
 * expand) only when the user steps to it, never while typing.
 */
import { useEffect, useMemo, useRef } from "react";
import { createStore, useStore } from "zustand";
import { centerOn } from "../canvas/viewport";
import { currentLayout } from "../canvas/MapCanvas";
import type { MapDocument, NodeId } from "../document/model";
import { reveal } from "../document/ops";
import { isVisible } from "../document/queries";
import { apply, getState, select, useEditor } from "../state/store";

export const searchStore = createStore<{ open: boolean; query: string; current: number; focusToken: number }>(() => ({
  open: false,
  query: "",
  current: 0,
  focusToken: 0,
}));

export const useSearch = <T,>(sel: (s: ReturnType<typeof searchStore.getState>) => T) => useStore(searchStore, sel);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** All topics matching the query, in reading (pre-order) order. */
export function findMatches(doc: MapDocument, query: string): NodeId[] {
  const q = fold(query.trim());
  if (!q) return [];
  const out: NodeId[] = [];
  const walk = (id: NodeId) => {
    if (fold(doc.nodes[id].text).includes(q)) out.push(id);
    doc.nodes[id].children.forEach(walk);
  };
  walk(doc.rootId);
  return out;
}

export function openSearch() {
  searchStore.setState((s) => ({ open: true, focusToken: s.focusToken + 1 }));
}

export function closeSearch() {
  searchStore.setState({ open: false });
  (document.activeElement as HTMLElement | null)?.blur();
}

function goTo(id: NodeId) {
  const doc = getState().doc;
  if (!isVisible(doc, id)) apply("Reveal", (d) => void reveal(d, id));
  select({ kind: "node", id });
  // Centre once the layout includes the revealed topic.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const n = currentLayout?.nodes.get(id);
      if (n) centerOn(n.x + n.width / 2, n.y + n.height / 2);
    }),
  );
}

export function SearchBar() {
  const { open, query, current, focusToken } = useSearch((s) => s);
  const doc = useEditor((s) => s.doc);
  const matches = useMemo(() => findMatches(doc, query), [doc, query]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [open, focusToken]);

  if (!open) return null;

  const step = (delta: number) => {
    if (!matches.length) return;
    const next = (current + delta + matches.length) % matches.length;
    searchStore.setState({ current: next });
    goTo(matches[next]);
  };

  const onChange = (q: string) => {
    const found = findMatches(getState().doc, q);
    // Jump to the first visible match while typing, without expanding anything.
    const firstVisible = found.findIndex((id) => isVisible(getState().doc, id));
    searchStore.setState({ query: q, current: Math.max(0, firstVisible) });
    if (firstVisible >= 0) {
      select({ kind: "node", id: found[firstVisible] });
      const n = currentLayout?.nodes.get(found[firstVisible]);
      if (n) centerOn(n.x + n.width / 2, n.y + n.height / 2);
    }
  };

  return (
    <div className="search-bar" role="search" data-own-keys>
      <input
        ref={input}
        type="search"
        placeholder="Find topic"
        aria-label="Find topic"
        value={query}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            closeSearch();
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
            e.preventDefault();
            input.current?.select();
          }
        }}
      />
      <span className="search-count">
        {query.trim() ? (matches.length ? `${Math.min(current + 1, matches.length)} of ${matches.length}` : "No matches") : ""}
      </span>
      <button aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => step(-1)} disabled={!matches.length}>
        ‹
      </button>
      <button aria-label="Next match" title="Next (Enter)" onClick={() => step(1)} disabled={!matches.length}>
        ›
      </button>
      <button aria-label="Close search" title="Close (Esc)" onClick={closeSearch}>
        ×
      </button>
    </div>
  );
}
