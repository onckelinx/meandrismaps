# Meandris Maps — Architecture

Meandris Maps is a local-first desktop mind-mapping app built with **Tauri 2**
(Rust shell, system webview) and a **React + TypeScript** frontend. There is no
server and no network use.

## Layers

```
src/
  document/     Pure domain model: MapDocument, tree operations, queries, palette.
                No rendering, no Tauri, no React. Fully unit-tested.
  state/        Editor store (zustand) + undo/redo history (Immer patches)
                + high-level user actions (add child, commit edit, ...).
  layout/       Automatic layout: (document, text measurer) -> map coordinates,
                boundaries ("clouds"), bounds. Pure and unit-tested.
  render/       Pure SVG scene (MapScene), branch geometry, map themes, fonts.
                Used for the screen, SVG/PNG/JPEG export and printing.
  canvas/       Interactive canvas: pan/zoom viewport, pointer hit-testing,
                drag & drop, inline text editor, animated layout transitions.
  app/          App shell: command registry, keyboard handling, menus, dialogs.
  persistence/  .meandrismap read/write, validation, autosave/recovery.
  import/ export/  Markdown import/export, SVG/PNG/JPEG export, printing.
  images/       Image asset store (bytes outside the undoable document).
  platform/     Desktop integration (Tauri) with a browser fallback for dev/tests.
src-tauri/      Rust: window, native menu, dialogs, atomic file writes, recovery.
```

Dependencies point downwards only: `document` knows nothing about anything
else; `layout` depends only on `document`; `render` on `layout`; and so on.

## Key decisions

### One custom SVG scene, no diagram library

The whole map is a single SVG drawn by `render/MapScene.tsx`. React Flow and
similar libraries were rejected: they model boxes joined by thin edges, while
Meandris Maps needs tapered filled branches, boundaries behind whole subtrees,
text-on-branch nodes and vector export. With one SVG renderer:

- the screen, SVG export, PNG/JPEG export and printing all use the same code;
- interaction never depends on DOM structure: the canvas hit-tests against the
  layout geometry;
- 1,000 nodes is a few thousand SVG elements, which renders comfortably.

`render/branches.ts` is the only place that knows what a branch looks like
(`branchPath`). Replacing the classic style (e.g. from a reference image) does
not touch layout or interaction.

### Layout: band stacking

`layout/layout.ts` uses classic band ("FreeMind-style") stacking: each visible
subtree occupies a vertical band; sibling bands are stacked and the span of
their branch lines is centred on the parent's line. This was chosen over
contour-packing (e.g. d3-flextree) because it is **predictable**: adding a node
pushes neighbours by exactly the extra height, which keeps the user oriented
while typing. Compactness is secondary to stability. Boundaries and
attached images enlarge a node's band so nothing intrudes into them.

The two-sided layout stores each top-level branch's `side` in the document so
branches never jump sides as the map grows. New top-level branches go to the
visually lighter side (by visible leaves).

Text is measured with canvas `measureText` using the **bundled Inter font**,
so the same file lays out identically on macOS, Linux and Windows.

### Undo/redo: Immer patches

Every document change goes through `state/store.ts#apply`, which runs the
change as an Immer recipe and records forward/inverse patches. There is no
per-feature undo code. Creating a node and typing its first text are merged
into one undo step. Selection is restored on undo.

### Document model

`MapDocument` is normalised: `nodes` keyed by stable id, each with `parentId`
and ordered `children`. Hierarchy and order are always explicit — never derived
from coordinates. Branch colour is stored on top-level branches (and on
explicit overrides) and inherited otherwise. Images are either free (map
coordinates) or attached to a node (offset from the node's centre).

### Native file format

See [FILE_FORMAT.md](FILE_FORMAT.md). A `.meandrismap` file is a ZIP container
holding `map.json` plus image assets, so maps are portable and self-contained.

### Desktop integration

The frontend talks to the desktop only through `src/platform/`. The Tauri
implementation uses a few small Rust commands (atomic file writes, recovery
storage, printing, files opened by the OS); a browser implementation keeps the
app runnable in a plain browser for development and scripted smoke tests.

- The main window is created in Rust (`src-tauri/src/lib.rs`), not in
  `tauri.conf.json`, because webview clipboard access (needed for the Edit
  menu's Cut/Copy/Paste on Linux) can only be enabled there.
- The native menu is generated from the command registry (`src/app/menu.ts`).
  Native menus capture keys before the webview, so accelerators are attached
  only to modifier shortcuts that never conflict with typing; plain keys and,
  on Linux, the text-editing shortcuts are handled in JavaScript.
- Crash-recovery snapshots live in the app data directory, one slot per
  running instance, each guarded by an OS file lock so a second instance never
  offers a live session as "recovered".
- Printing renders the map onto page-sized SVG views of a single shared
  drawing (`src/export/print.ts`) and calls the webview's native print.
- On macOS, files opened from Finder arrive as an event (`RunEvent::Opened`),
  not on the command line. `tauri.conf.json` exports `.meandrismap` as the
  type `io.github.onckelinx.meandrismaps.map`, so Finder knows it by name.
  Quit from the Dock, logout and shutdown skip the unsaved-changes prompt (the
  windowing library gives the app no chance to cancel); the recovery snapshot
  covers that work.

## Testing

- `npm test` — Vitest unit tests for tree operations, history, keyboard flows,
  layout (including no-overlap checks at 10/100/500/1,000 nodes), boundaries,
  Markdown import/export and the file format.
- `npm run typecheck` — TypeScript.
