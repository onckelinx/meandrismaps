/**
 * The interactive canvas: draws the scene inside a pan/zoom transform,
 * hit-tests pointer input against the layout and hosts the inline editor.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { moveNode } from "../document/ops";
import { subtreeIds } from "../document/queries";
import { displayUrl, onAssetsChanged } from "../images/assetStore";
import { installImageDrop } from "../images/imageActions";
import { outAnchor, type MapLayout, type NodeLayout } from "../layout/layout";
import { FONT_FAMILY } from "../layout/styles";
import { MapScene } from "../render/MapScene";
import type { MapTheme } from "../render/theme";
import { commitEditing, startEditing, toggleCollapse } from "../state/actions";
import { apply, getState, select, useEditor } from "../state/store";
import { openContextMenu } from "../ui/ContextMenu";
import { findMatches, useSearch } from "../ui/SearchBar";
import { canvasMenu, imageMenu, nodeMenu } from "./contextMenus";
import { findDropTarget, isNoOpDrop, type DropTarget } from "./dropTarget";
import { ImageOverlay, useImageGestures, usePreviewImageId, type ImageGesture } from "./imageInteraction";
import { NodeEditor } from "./NodeEditor";
import { useMapLayout } from "./useMapLayout";
import { centerOn, ensureVisible, panBy, screenToMap, useViewport, viewStore, zoomAt } from "./viewport";

export type Hit =
  | { kind: "node"; id: string }
  | { kind: "toggle"; id: string }
  | { kind: "image"; id: string }
  | null;

/** Layout currently on screen, for code outside the canvas (navigation, menus). */
export let currentLayout: MapLayout | null = null;

/** Centre of a topic's collapse toggle / hidden-count badge. */
export function badgeCenter(n: NodeLayout) {
  const dir = n.side === "left" ? -1 : 1;
  if (n.side === "root") return { x: n.x + n.width + 12, y: n.y + n.height / 2 };
  return { x: (n.side === "left" ? n.x : n.x + n.width) + dir * 12, y: n.y + n.height };
}

export function hitTest(layout: MapLayout, mx: number, my: number, slop = 4): Hit {
  // Nodes are drawn on top of images, so test them first (topmost last).
  for (let i = layout.order.length - 1; i >= 0; i--) {
    const n = layout.nodes.get(layout.order[i])!;
    if (n.hasChildren && n.side !== "root") {
      const b = badgeCenter(n);
      if (Math.hypot(mx - b.x, my - b.y) <= 11) return { kind: "toggle", id: n.id };
    }
    if (mx >= n.x - slop && mx <= n.x + n.width + slop && my >= n.y - slop && my <= n.y + n.height + slop) {
      return { kind: "node", id: n.id };
    }
  }
  for (let i = layout.images.length - 1; i >= 0; i--) {
    const r = layout.images[i].rect;
    if (mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height) {
      return { kind: "image", id: layout.images[i].id };
    }
  }
  return null;
}

type Gesture =
  | { kind: "pan"; pointerId: number; lastX: number; lastY: number }
  | { kind: "node"; pointerId: number; id: string; startX: number; startY: number; active: boolean }
  | ImageGesture;

interface DragState {
  id: string;
  x: number;
  y: number;
  target: DropTarget | null;
}

const DRAG_THRESHOLD = 5;
const EDGE = 40;

export function MapCanvas({ theme }: { theme: MapTheme }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { display, target } = useMapLayout();
  currentLayout = display;
  const view = useViewport((v) => v);
  const doc = useEditor((s) => s.doc);
  const editing = useEditor((s) => s.editing);
  const selection = useEditor((s) => s.selection);
  const rootId = doc.rootId;
  const gesture = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [, bumpAssets] = useState(0);
  const lastClient = useRef({ x: 0, y: 0 });
  const edgeLoop = useRef<number | null>(null);
  const searchOpen = useSearch((s) => s.open);
  const query = useSearch((s) => s.query);
  const matches = useMemo(() => (searchOpen ? findMatches(doc, query) : null), [searchOpen, doc, query]);
  const images = useImageGestures();
  const previewImage = usePreviewImageId();

  useEffect(() => onAssetsChanged(() => bumpAssets((n) => n + 1)), []);
  useEffect(() => installImageDrop(containerRef.current!), []);

  // Track the canvas size.
  useLayoutEffect(() => {
    const el = containerRef.current!;
    const update = () => viewStore.setState({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Centre the root whenever a different document is loaded.
  useLayoutEffect(() => {
    viewStore.setState({ k: 1 });
    centerOn(0, 0, false);
  }, [rootId]);

  // Keep the selected node in view after keyboard navigation and edits.
  const selectedId = selection?.kind === "node" ? selection.id : null;
  const selectedNode = selectedId ? display.nodes.get(selectedId) : undefined;
  const selectedTarget = selectedId ? target.nodes.get(selectedId) : undefined;
  useEffect(() => {
    if (!selectedTarget || gesture.current) return;
    const n = selectedTarget;
    ensureVisible({ x: n.x, y: n.y, width: n.width, height: n.height });
  }, [selectedTarget]);

  // Wheel / pinch zoom (non-passive so the page never scrolls).
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = e.deltaY * unit;
      if (e.shiftKey && !e.ctrlKey) {
        panBy(-dy, 0);
        return;
      }
      const intensity = e.ctrlKey ? 0.01 : 0.0018;
      zoomAt(Math.exp(-dy * intensity), sx, sy);
    };
    // Safari/WebKit on macOS reports trackpad pinch as gesture events.
    let gestureStartK = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStartK = viewStore.getState().k;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const rect = svg.getBoundingClientRect();
      zoomAt((gestureStartK * ge.scale) / viewStore.getState().k, ge.clientX - rect.left, ge.clientY - rect.top);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("gesturestart", onGestureStart);
    svg.addEventListener("gesturechange", onGestureChange);
    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("gesturestart", onGestureStart);
      svg.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  const clientToMap = useCallback((cx: number, cy: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return screenToMap(cx - rect.left, cy - rect.top);
  }, []);

  const stopEdgePan = () => {
    if (edgeLoop.current !== null) cancelAnimationFrame(edgeLoop.current);
    edgeLoop.current = null;
  };

  const updateDrag = useCallback(
    (id: string, cx: number, cy: number) => {
      const p = clientToMap(cx, cy);
      setDrag({ id, x: p.x, y: p.y, target: findDropTarget(getState().doc, currentLayout!, id, p.x, p.y) });
    },
    [clientToMap],
  );

  /** While dragging a topic near an edge, keep scrolling the canvas. */
  const edgePan = useCallback(
    (id: string) => {
      stopEdgePan();
      const rect = svgRef.current!.getBoundingClientRect();
      const { x, y } = lastClient.current;
      const dx = x < rect.left + EDGE ? 10 : x > rect.right - EDGE ? -10 : 0;
      const dy = y < rect.top + EDGE ? 10 : y > rect.bottom - EDGE ? -10 : 0;
      if (!dx && !dy) return;
      const step = () => {
        panBy(dx, dy);
        updateDrag(id, lastClient.current.x, lastClient.current.y);
        edgeLoop.current = requestAnimationFrame(step);
      };
      edgeLoop.current = requestAnimationFrame(step);
    },
    [updateDrag],
  );

  const cancelGesture = useCallback(() => {
    stopEdgePan();
    gesture.current = null;
    images.cancel();
    setDrag(null);
    setPanning(false);
  }, [images]);

  // Escape cancels a drag in progress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && gesture.current && gesture.current.kind !== "pan") {
        e.preventDefault();
        e.stopPropagation();
        cancelGesture();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancelGesture]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return; // context menu handled separately
    const p = clientToMap(e.clientX, e.clientY);
    const s = getState();
    const handle = e.button === 0 ? images.handleAt(display, p, viewStore.getState().k) : null;
    const hit = handle ? null : e.button === 1 ? null : hitTest(display, p.x, p.y);
    if (s.editing && hit?.kind === "node" && hit.id === s.editing.id) return; // clicks inside the editor
    if (s.editing) commitEditing();

    if (hit?.kind === "toggle") {
      toggleCollapse(hit.id);
      select({ kind: "node", id: hit.id });
      return;
    }
    svgRef.current!.setPointerCapture(e.pointerId);
    lastClient.current = { x: e.clientX, y: e.clientY };
    if (handle) {
      gesture.current = images.begin(handle.id, e, p, display, handle.handle);
      return;
    }
    if (hit?.kind === "node") {
      select({ kind: "node", id: hit.id });
      gesture.current = { kind: "node", pointerId: e.pointerId, id: hit.id, startX: e.clientX, startY: e.clientY, active: false };
      return;
    }
    if (hit?.kind === "image") {
      gesture.current = images.begin(hit.id, e, p, display);
      return;
    }
    // Empty canvas: pan.
    if (e.button === 0) select(null);
    gesture.current = { kind: "pan", pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    setPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    lastClient.current = { x: e.clientX, y: e.clientY };
    if (!g || g.pointerId !== e.pointerId) {
      if (e.buttons === 0) {
        const p = clientToMap(e.clientX, e.clientY);
        const hit = hitTest(display, p.x, p.y);
        const id = hit && hit.kind !== "image" ? hit.id : null;
        if (id !== hover) setHover(id);
      }
      return;
    }
    if (g.kind === "pan") {
      panBy(e.clientX - g.lastX, e.clientY - g.lastY);
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      return;
    }
    if (g.kind === "node") {
      if (!g.active) {
        if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return;
        if (g.id === getState().doc.rootId) {
          // The central topic does not move; dragging it pans instead.
          gesture.current = { kind: "pan", pointerId: g.pointerId, lastX: e.clientX, lastY: e.clientY };
          setPanning(true);
          return;
        }
        g.active = true;
        setHover(null);
      }
      updateDrag(g.id, e.clientX, e.clientY);
      edgePan(g.id);
      return;
    }
    images.move(g, clientToMap(e.clientX, e.clientY), e.shiftKey);
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    setPanning(false);
    stopEdgePan();
    if (g.kind === "node") {
      if (!g.active) return;
      const p = clientToMap(e.clientX, e.clientY);
      const doc = getState().doc;
      const t = findDropTarget(doc, currentLayout!, g.id, p.x, p.y);
      setDrag(null);
      if (t && !isNoOpDrop(doc, g.id, t)) {
        apply("Move Topic", (d) => moveNode(d, g.id, t.parentId, t.index, t.side), {
          select: { kind: "node", id: g.id },
        });
      }
      return;
    }
    if (g.kind !== "pan") images.end(g);
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const p = clientToMap(e.clientX, e.clientY);
    const hit = hitTest(display, p.x, p.y);
    if (hit?.kind === "node") startEditing(hit.id, { selectAll: true });
  };

  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    commitEditing();
    const p = clientToMap(e.clientX, e.clientY);
    const hit = hitTest(display, p.x, p.y);
    if (hit?.kind === "node" || hit?.kind === "toggle") openContextMenu(e.clientX, e.clientY, nodeMenu(hit.id));
    else if (hit?.kind === "image") openContextMenu(e.clientX, e.clientY, imageMenu(hit.id));
    else openContextMenu(e.clientX, e.clientY, canvasMenu());
  };

  // A node created this instant may not be in the animated layout yet; the
  // editor must still mount immediately so no keystroke is lost.
  const editingNode = editing ? (display.nodes.get(editing.id) ?? target.nodes.get(editing.id)) : undefined;
  const k = view.k;
  const dragId = drag?.id;
  const dimmed = useMemo(() => (dragId ? new Set(subtreeIds(doc, dragId)) : undefined), [dragId, doc]);
  const hoverNode = hover ? display.nodes.get(hover) : undefined;

  return (
    <div className="canvas" ref={containerRef} style={{ background: theme.background }}>
      <svg
        ref={svgRef}
        width={view.width}
        height={view.height}
        role="application"
        aria-label="Mind map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelGesture}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        style={{ cursor: panning || drag ? "grabbing" : "default" }}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${k})`}>
          {matches && (
            <g className="search-highlights">
              {matches.map((id) => {
                const n = display.nodes.get(id);
                if (!n) return null;
                return (
                  <rect
                    key={id}
                    x={n.x - 3}
                    y={n.y - 2}
                    width={n.width + 6}
                    height={n.height + 4}
                    rx={6}
                    fill={theme.name === "dark" ? "#8a6d1c" : "#ffe08a"}
                    opacity={0.75}
                  />
                );
              })}
            </g>
          )}
          <MapScene
            layout={display}
            theme={theme}
            imageUrl={(id, w) => displayUrl(id, w * k)}
            editingId={editing?.id}
            dimmed={dimmed}
            hiddenImage={previewImage}
          />
          {hoverNode && hoverNode.hasChildren && !hoverNode.collapsed && hoverNode.side !== "root" && !drag && (
            <CollapseToggle node={hoverNode} theme={theme} />
          )}
          {selectedNode && !drag && (
            <rect
              className="selection-ring"
              x={selectedNode.x - 5}
              y={selectedNode.y - 5}
              width={selectedNode.width + 10}
              height={selectedNode.height + 10}
              rx={selectedNode.style.shape === "bubble" ? Math.min(selectedNode.height / 2 + 5, 27) : 7}
              fill="none"
              stroke={theme.selection}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <ImageOverlay layout={display} theme={theme} k={k} />
          {drag && <DragPreview drag={drag} layout={display} theme={theme} />}
        </g>
      </svg>
      {editing && editingNode && <NodeEditor key={editing.id} node={editingNode} editing={editing} theme={theme} />}
      <div className="visually-hidden" aria-live="polite">
        {selectedId && doc.nodes[selectedId] ? describeNode(doc, selectedId) : ""}
      </div>
    </div>
  );
}

/** Spoken description of the selected topic for screen readers. */
function describeNode(doc: ReturnType<typeof getState>["doc"], id: string): string {
  const n = doc.nodes[id];
  let level = 0;
  for (let p = n.parentId; p; p = doc.nodes[p].parentId) level++;
  const parts = [n.text || "Empty topic", level === 0 ? "central topic" : `level ${level}`];
  if (n.children.length) parts.push(`${n.children.length} ${n.children.length === 1 ? "child" : "children"}`);
  if (n.collapsed) parts.push("collapsed");
  return parts.join(", ");
}

function CollapseToggle({ node, theme }: { node: NodeLayout; theme: MapTheme }) {
  const c = badgeCenter(node);
  return (
    <g pointerEvents="none">
      <circle cx={c.x} cy={c.y} r={8} fill={theme.badgeFill} stroke={node.color} strokeWidth={1.5} />
      <line x1={c.x - 3.5} y1={c.y} x2={c.x + 3.5} y2={c.y} stroke={node.color} strokeWidth={1.6} strokeLinecap="round" />
    </g>
  );
}

/** Ghost of the dragged topic plus a dashed branch from its future parent. */
function DragPreview({ drag, layout, theme }: { drag: DragState; layout: MapLayout; theme: MapTheme }) {
  const node = layout.nodes.get(drag.id);
  if (!node) return null;
  const t = drag.target;
  const parent = t ? layout.nodes.get(t.parentId) : undefined;
  const ref = t ? layout.nodes.get(t.refId) : undefined;
  const leftward = t?.side === "left" || (!t?.side && parent?.side === "left");
  const dir = leftward ? -1 : 1;
  const ghostW = Math.min(node.width, 220);
  const anchor = parent
    ? parent.side === "root"
      ? { x: parent.x + parent.width / 2 + dir * (parent.width / 2 - 6), y: parent.y + parent.height / 2 }
      : outAnchor(parent)
    : null;
  // As a new child, show the ghost where it will land (just beyond the parent);
  // otherwise it follows the pointer.
  let ghostIn: { x: number; y: number };
  if (t?.mode === "child" && anchor) {
    const reach = parent!.side === "root" ? 60 : 44;
    const y = Math.max(anchor.y - 70, Math.min(anchor.y + 70, drag.y + node.height / 2));
    ghostIn = { x: anchor.x + dir * reach, y };
  } else {
    ghostIn = { x: drag.x + dir * 10, y: drag.y + node.height / 2 };
  }
  const gx = leftward ? ghostIn.x - ghostW : ghostIn.x;
  const gy = ghostIn.y - node.height;
  let connector: string | null = null;
  if (anchor) {
    const a = anchor;
    const dx = ghostIn.x - a.x;
    connector = `M${a.x},${a.y} C${a.x + dx * 0.5},${a.y} ${ghostIn.x - dx * 0.5},${ghostIn.y} ${ghostIn.x},${ghostIn.y}`;
  }
  let bar: { x: number; y: number; w: number } | null = null;
  if (t && ref && t.mode !== "child") {
    const y = t.mode === "before" ? ref.y - 4 : ref.y + ref.height + 4;
    bar = { x: ref.x, y, w: ref.width };
  }
  return (
    <g pointerEvents="none">
      {connector && (
        <path d={connector} fill="none" stroke={theme.selection} strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
      )}
      {t?.mode === "child" && parent && (
        <rect
          x={parent.x - 5}
          y={parent.y - 5}
          width={parent.width + 10}
          height={parent.height + 10}
          rx={parent.side === "root" ? Math.min(parent.height / 2 + 5, 27) : 7}
          fill={theme.selection}
          fillOpacity={0.1}
          stroke={theme.selection}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {bar && <rect x={bar.x} y={bar.y - 1.5} width={bar.w} height={3} rx={1.5} fill={theme.selection} />}
      <rect
        x={gx - 4}
        y={gy - 2}
        width={ghostW + 8}
        height={node.height + 4}
        rx={6}
        fill={theme.badgeFill}
        stroke={t ? theme.selection : theme.mutedText}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        opacity={0.95}
      />
      <text
        x={gx + 4}
        y={gy + node.height / 2 + node.style.fontSize * 0.35}
        fontFamily={FONT_FAMILY}
        fontSize={node.style.fontSize}
        fontWeight={node.style.fontWeight}
        fill={theme.text}
      >
        {truncate(node.lines.join(" "), 28)}
      </text>
      {!t && (
        <text x={gx} y={gy + node.height + 18} fontFamily={FONT_FAMILY} fontSize={11} fill={theme.mutedText}>
          Release to cancel
        </text>
      )}
    </g>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
