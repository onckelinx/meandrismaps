/**
 * Branch geometry. The rest of the renderer only calls `branchPath`, so the
 * classic style can be replaced (e.g. once the reference image arrives)
 * without touching layout or the canvas.
 */
import type { Point } from "../layout/layout";

export interface BranchGeometry {
  from: Point;
  to: Point;
  startWidth: number;
  endWidth: number;
}

const SAMPLES = 14;

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function bezierTangent(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return {
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
  };
}

const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

/** Smooth path through points using Catmull-Rom splines converted to cubic Béziers. */
function smoothThrough(points: Point[], move: boolean): string {
  let d = move ? `M${fmt(points[0].x)},${fmt(points[0].y)}` : `L${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  return d;
}

/**
 * Classic organic branch: an S-curve leaving the parent horizontally and
 * arriving horizontally, filled as a shape that tapers from `startWidth` to
 * `endWidth`.
 */
export function branchPath(g: BranchGeometry): string {
  const { from, to } = g;
  const dx = to.x - from.x;
  const c1 = { x: from.x + dx * 0.5, y: from.y };
  const c2 = { x: to.x - dx * 0.55, y: to.y };
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const p = bezier(from, c1, c2, to, t);
    const tan = bezierTangent(from, c1, c2, to, t);
    const len = Math.hypot(tan.x, tan.y) || 1;
    // Normal, consistently oriented regardless of direction of travel.
    const nx = -tan.y / len;
    const ny = tan.x / len;
    // Thick near the parent, easing into the child's line width.
    const w = g.endWidth + (g.startWidth - g.endWidth) * Math.pow(1 - t, 1.6);
    upper.push({ x: p.x + (nx * w) / 2, y: p.y + (ny * w) / 2 });
    lower.push({ x: p.x - (nx * w) / 2, y: p.y - (ny * w) / 2 });
  }
  lower.reverse();
  return smoothThrough(upper, true) + smoothThrough(lower, false) + "Z";
}

/** The underline beneath a node's label, slightly tapering towards its far end. */
export function underlinePath(start: Point, end: Point, width: number): string {
  const dir = Math.sign(end.x - start.x) || 1;
  const endW = width * 0.7;
  const r = endW / 2;
  return (
    `M${fmt(start.x)},${fmt(start.y - width / 2)}` +
    `L${fmt(end.x - dir * r)},${fmt(end.y - endW / 2)}` +
    `A${fmt(r)},${fmt(r)} 0 0 ${dir > 0 ? 1 : 0} ${fmt(end.x - dir * r)},${fmt(end.y + endW / 2)}` +
    `L${fmt(start.x)},${fmt(start.y + width / 2)}Z`
  );
}
