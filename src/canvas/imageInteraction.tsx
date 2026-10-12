/**
 * Moving and resizing images with the mouse. While a gesture is in progress
 * the change is only previewed; releasing commits a single undoable step.
 */
import { createStore, useStore } from "zustand";
import type { Point, MapLayout, Rect } from "../layout/layout";
import type { MapTheme } from "../render/theme";
import { updateImage } from "../document/ops";
import { apply, getState, select, useEditor } from "../state/store";
import { displayUrl } from "../images/assetStore";

type Handle = "nw" | "ne" | "sw" | "se";

export type ImageGesture =
  | { kind: "imageMove"; pointerId: number; id: string; start: Point; orig: Rect; active: boolean }
  | { kind: "imageResize"; pointerId: number; id: string; handle: Handle; start: Point; orig: Rect };

/** The previewed rectangle of the image being moved/resized (map coordinates). */
const previewStore = createStore<{ id: string | null; rect: Rect | null }>(() => ({ id: null, rect: null }));

const HANDLE = 7;

function imageRect(layout: MapLayout, id: string): Rect | undefined {
  return layout.images.find((i) => i.id === id)?.rect;
}

function handles(r: Rect): Record<Handle, Point> {
  return {
    nw: { x: r.x, y: r.y },
    ne: { x: r.x + r.width, y: r.y },
    sw: { x: r.x, y: r.y + r.height },
    se: { x: r.x + r.width, y: r.y + r.height },
  };
}

export function useImageGestures() {
  return {
    /** A resize handle of the selected image under the pointer, if any. */
    handleAt(layout: MapLayout, p: Point, k: number): { id: string; handle: Handle } | null {
      const sel = getState().selection;
      if (sel?.kind !== "image") return null;
      const r = imageRect(layout, sel.id);
      if (!r) return null;
      for (const [h, c] of Object.entries(handles(r)) as [Handle, Point][]) {
        if (Math.abs(p.x - c.x) <= (HANDLE + 3) / k && Math.abs(p.y - c.y) <= (HANDLE + 3) / k) return { id: sel.id, handle: h };
      }
      return null;
    },

    begin(id: string, e: { pointerId: number }, p: Point, layout: MapLayout, handle?: Handle): ImageGesture | null {
      const r = imageRect(layout, id);
      if (!r) return null;
      select({ kind: "image", id });
      if (handle) return { kind: "imageResize", pointerId: e.pointerId, id, handle, start: p, orig: { ...r } };
      return { kind: "imageMove", pointerId: e.pointerId, id, start: p, orig: { ...r }, active: false };
    },

    move(g: ImageGesture, p: Point, shift: boolean) {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (g.kind === "imageMove") {
        if (!g.active && Math.hypot(dx, dy) < 3) return;
        g.active = true;
        previewStore.setState({ id: g.id, rect: { ...g.orig, x: g.orig.x + dx, y: g.orig.y + dy } });
        return;
      }
      // Resize from the dragged corner, keeping the aspect ratio unless Shift is held.
      const o = g.orig;
      const right = g.handle === "ne" || g.handle === "se";
      const bottom = g.handle === "sw" || g.handle === "se";
      let w = Math.max(16, right ? o.width + dx : o.width - dx);
      let h = Math.max(16, bottom ? o.height + dy : o.height - dy);
      if (!shift) {
        const ratio = o.width / o.height;
        if (w / h > ratio) h = w / ratio;
        else w = h * ratio;
      }
      const x = right ? o.x : o.x + o.width - w;
      const y = bottom ? o.y : o.y + o.height - h;
      previewStore.setState({ id: g.id, rect: { x, y, width: w, height: h } });
    },

    end(g: ImageGesture) {
      const rect = previewStore.getState().rect;
      previewStore.setState({ id: null, rect: null });
      if (!rect) return;
      const img = getState().doc.images[g.id];
      if (!img) return;
      // Convert back to the image's own coordinate space (relative for attached images).
      const dx = rect.x - g.orig.x;
      const dy = rect.y - g.orig.y;
      apply(g.kind === "imageMove" ? "Move Image" : "Resize Image", (d) =>
        updateImage(d, g.id, {
          x: img.x + dx,
          y: img.y + dy,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }),
      );
    },

    cancel() {
      previewStore.setState({ id: null, rect: null });
    },
  };
}

export function usePreviewImageId(): string | null {
  return useStore(previewStore, (s) => s.id);
}

/** Selection frame, resize handles and live preview for images. */
export function ImageOverlay({ layout, theme, k }: { layout: MapLayout; theme: MapTheme; k: number }) {
  const selection = useEditor((s) => s.selection);
  const preview = useStore(previewStore, (s) => s);
  const doc = useEditor((s) => s.doc);
  const selId = selection?.kind === "image" ? selection.id : null;
  const items: React.ReactElement[] = [];
  if (preview.id && preview.rect) {
    const img = doc.images[preview.id];
    const href = img ? displayUrl(img.assetId, preview.rect.width * k) : undefined;
    if (href) {
      items.push(
        <image
          key="preview"
          href={href}
          x={preview.rect.x}
          y={preview.rect.y}
          width={preview.rect.width}
          height={preview.rect.height}
          preserveAspectRatio="none"
          opacity={0.85}
        />,
      );
    }
  }
  const r = preview.id === selId && preview.rect ? preview.rect : selId ? imageRect(layout, selId) : undefined;
  if (selId && r) {
    items.push(
      <rect
        key="frame"
        x={r.x}
        y={r.y}
        width={r.width}
        height={r.height}
        fill="none"
        stroke={theme.selection}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />,
    );
    for (const [h, c] of Object.entries(handles(r))) {
      items.push(
        <rect
          key={h}
          x={c.x - HANDLE / 2 / k}
          y={c.y - HANDLE / 2 / k}
          width={HANDLE / k}
          height={HANDLE / k}
          fill={theme.badgeFill}
          stroke={theme.selection}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />,
      );
    }
    const img = doc.images[selId];
    if (img?.nodeId) {
      // Show which topic the image belongs to.
      const n = layout.nodes.get(img.nodeId);
      if (n) {
        items.push(
          <line
            key="owner"
            x1={r.x + r.width / 2}
            y1={r.y + r.height / 2}
            x2={n.x + n.width / 2}
            y2={n.y + n.height / 2}
            stroke={theme.selection}
            strokeWidth={1}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />,
        );
      }
    }
  }
  return <g pointerEvents="none">{items}</g>;
}
