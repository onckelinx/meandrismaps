/**
 * Canvas viewport: screen = map * k + (x, y). Kept outside the editor store so
 * panning never re-renders document-driven components.
 */
import { createStore, useStore } from "zustand";
import type { Rect } from "../layout/layout";

export interface Viewport {
  x: number;
  y: number;
  k: number;
  /** Size of the canvas element in CSS pixels. */
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 4;

export const viewStore = createStore<Viewport>(() => ({ x: 0, y: 0, k: 1, width: 800, height: 600 }));
export const useViewport = <T>(sel: (v: Viewport) => T) => useStore(viewStore, sel);

const clampK = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

let anim: number | null = null;

function stopAnimation() {
  if (anim !== null) cancelAnimationFrame(anim);
  anim = null;
}

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Moves the viewport to a target, animated unless the user prefers reduced motion. */
export function animateTo(target: { x: number; y: number; k: number }, duration = 220) {
  stopAnimation();
  const from = viewStore.getState();
  if (reducedMotion() || duration <= 0) {
    viewStore.setState(target);
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    viewStore.setState({
      x: from.x + (target.x - from.x) * e,
      y: from.y + (target.y - from.y) * e,
      k: from.k + (target.k - from.k) * e,
    });
    anim = t < 1 ? requestAnimationFrame(step) : null;
  };
  anim = requestAnimationFrame(step);
}

export function panBy(dx: number, dy: number) {
  stopAnimation();
  const v = viewStore.getState();
  viewStore.setState({ x: v.x + dx, y: v.y + dy });
}

/** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
export function zoomAt(factor: number, sx: number, sy: number, animated = false) {
  const v = viewStore.getState();
  const k = clampK(v.k * factor);
  const mx = (sx - v.x) / v.k;
  const my = (sy - v.y) / v.k;
  const target = { k, x: sx - mx * k, y: sy - my * k };
  if (animated) animateTo(target, 160);
  else {
    stopAnimation();
    viewStore.setState(target);
  }
}

export function zoomStep(dir: 1 | -1) {
  const v = viewStore.getState();
  zoomAt(dir > 0 ? 1.25 : 0.8, v.width / 2, v.height / 2, true);
}

export function resetZoom() {
  const v = viewStore.getState();
  zoomAt(1 / v.k, v.width / 2, v.height / 2, true);
}

/** Fits a map rectangle into the view. */
export function fitRect(r: Rect, opts: { maxZoom?: number; animated?: boolean } = {}) {
  const v = viewStore.getState();
  const margin = 48;
  const k = clampK(
    Math.min(
      opts.maxZoom ?? 1.5,
      (v.width - margin * 2) / Math.max(r.width, 1),
      (v.height - margin * 2) / Math.max(r.height, 1),
    ),
  );
  const target = {
    k,
    x: v.width / 2 - (r.x + r.width / 2) * k,
    y: v.height / 2 - (r.y + r.height / 2) * k,
  };
  if (opts.animated === false) viewStore.setState(target);
  else animateTo(target);
}

/** Centres a map point. */
export function centerOn(px: number, py: number, animated = true) {
  const v = viewStore.getState();
  const target = { k: v.k, x: v.width / 2 - px * v.k, y: v.height / 2 - py * v.k };
  if (animated) animateTo(target);
  else viewStore.setState(target);
}

/** Pans the minimum amount needed so the map rect is inside the view (with margin). */
export function ensureVisible(r: Rect, margin = 60) {
  const v = viewStore.getState();
  const left = r.x * v.k + v.x;
  const top = r.y * v.k + v.y;
  const right = (r.x + r.width) * v.k + v.x;
  const bottom = (r.y + r.height) * v.k + v.y;
  let dx = 0;
  let dy = 0;
  if (right - left > v.width - margin * 2) dx = v.width / 2 - (left + right) / 2;
  else if (left < margin) dx = margin - left;
  else if (right > v.width - margin) dx = v.width - margin - right;
  if (bottom - top > v.height - margin * 2) dy = v.height / 2 - (top + bottom) / 2;
  else if (top < margin) dy = margin - top;
  else if (bottom > v.height - margin) dy = v.height - margin - bottom;
  if (dx || dy) animateTo({ k: v.k, x: v.x + dx, y: v.y + dy }, 180);
}

export function screenToMap(sx: number, sy: number) {
  const v = viewStore.getState();
  return { x: (sx - v.x) / v.k, y: (sy - v.y) / v.k };
}
