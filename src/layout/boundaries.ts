/**
 * Branch boundaries ("clouds"): a smooth convex enclosure around a node, its
 * visible descendants and their attached images. Nested boundaries are
 * computed first so outer ones enclose them.
 */
import type { MapDocument, NodeId } from "../document/model";
import type { ImageLayout, NodeLayout, Point, Rect } from "./layout";
import { BOUNDARY_PAD } from "./styles";

export interface BoundaryShape {
  nodeId: NodeId;
  /** SVG path data. */
  path: string;
  bounds: Rect;
  /** Branch colour of the bounded node. */
  color: string;
  fill?: string;
  stroke?: string;
  /** Nesting level (0 = outermost); used for draw order. */
  level: number;
}

export function computeBoundaries(
  doc: MapDocument,
  nodes: Map<NodeId, NodeLayout>,
  order: NodeId[],
  images: ImageLayout[],
): BoundaryShape[] {
  const imagesByNode = new Map<NodeId, ImageLayout[]>();
  for (const img of images) {
    if (!img.image.nodeId) continue;
    const list = imagesByNode.get(img.image.nodeId) ?? [];
    list.push(img);
    imagesByNode.set(img.image.nodeId, list);
  }

  const hulls = new Map<NodeId, Point[]>();
  const shapes: BoundaryShape[] = [];

  // Reverse pre-order: descendants are processed before their ancestors.
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const node = doc.nodes[id];
    if (!node.boundary) continue;
    const points: Point[] = [];
    const visit = (nid: NodeId) => {
      const n = nodes.get(nid);
      if (!n) return;
      if (nid !== id && hulls.has(nid)) {
        // Enclose the nested boundary with some breathing room.
        for (const p of inflatePolygon(hulls.get(nid)!, BOUNDARY_PAD * 0.6)) points.push(p);
      } else {
        pushRect(points, { x: n.x, y: n.y, width: n.width, height: n.height + 2 }, BOUNDARY_PAD);
        for (const img of imagesByNode.get(nid) ?? []) pushRect(points, img.rect, BOUNDARY_PAD);
      }
      if (!doc.nodes[nid].collapsed) for (const c of doc.nodes[nid].children) visit(c);
    };
    visit(id);
    if (!points.length) continue;
    const hull = convexHull(points);
    hulls.set(id, hull);
    shapes.push({
      nodeId: id,
      path: roundedPolygonPath(hull, 22),
      bounds: polygonBounds(hull),
      color: nodes.get(id)!.color,
      fill: node.boundary.fill,
      stroke: node.boundary.stroke,
      level: 0,
    });
  }

  // Outer boundaries are drawn first.
  const levelOf = (id: NodeId) => {
    let level = 0;
    let cur = doc.nodes[id].parentId;
    while (cur) {
      if (doc.nodes[cur].boundary && hulls.has(cur)) level++;
      cur = doc.nodes[cur].parentId;
    }
    return level;
  };
  for (const s of shapes) s.level = levelOf(s.nodeId);
  shapes.sort((a, b) => a.level - b.level);
  return shapes;
}

function pushRect(points: Point[], r: Rect, pad: number) {
  points.push(
    { x: r.x - pad, y: r.y - pad },
    { x: r.x + r.width + pad, y: r.y - pad },
    { x: r.x + r.width + pad, y: r.y + r.height + pad },
    { x: r.x - pad, y: r.y + r.height + pad },
  );
}

/** Andrew's monotone chain. Returns the hull in counter-clockwise order. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Pushes each vertex outwards from the centroid (good enough for convex shapes). */
function inflatePolygon(poly: Point[], by: number): Point[] {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * by, y: p.y + (dy / len) * by };
  });
}

function polygonBounds(poly: Point[]): Rect {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Closed path through a convex polygon with each corner rounded. */
export function roundedPolygonPath(poly: Point[], radius: number): string {
  const n = poly.length;
  if (n < 3) return "";
  const f = (v: number) => Math.round(v * 10) / 10;
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const toPrev = { x: prev.x - cur.x, y: prev.y - cur.y };
    const toNext = { x: next.x - cur.x, y: next.y - cur.y };
    const lp = Math.hypot(toPrev.x, toPrev.y) || 1;
    const ln = Math.hypot(toNext.x, toNext.y) || 1;
    const rp = Math.min(radius, lp / 2);
    const rn = Math.min(radius, ln / 2);
    const a = { x: cur.x + (toPrev.x / lp) * rp, y: cur.y + (toPrev.y / lp) * rp };
    const b = { x: cur.x + (toNext.x / ln) * rn, y: cur.y + (toNext.y / ln) * rn };
    d += `${i === 0 ? "M" : "L"}${f(a.x)},${f(a.y)}Q${f(cur.x)},${f(cur.y)} ${f(b.x)},${f(b.y)}`;
  }
  return d + "Z";
}
