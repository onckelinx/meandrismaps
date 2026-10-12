/**
 * Automatic mind-map layout.
 *
 * Band ("FreeMind-style") stacking: every visible subtree occupies a vertical
 * band; sibling bands are stacked and centred on the parent's branch line.
 * Growing one branch only pushes its neighbours by the extra height, which
 * keeps the map visually stable while the user types.
 *
 * Pure function of (document, text measurer). Produces map coordinates only.
 */
import type { MapDocument, MapImage, NodeId, Side } from "../document/model";
import { effectiveColor, resolveTopLevelSides } from "../document/queries";
import { computeBoundaries, type BoundaryShape } from "./boundaries";
import {
  BOUNDARY_PAD,
  cssFont,
  horizontalGap,
  styleForDepth,
  verticalGap,
  type NodeStyle,
} from "./styles";
import { wrapText, type MeasureWidth } from "./text";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeLayout {
  id: NodeId;
  parentId: NodeId | null;
  depth: number;
  /** "root" for the root node. */
  side: Side | "root";
  /** Label box, top-left in map coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  style: NodeStyle;
  color: string;
  /** Number of hidden descendants when collapsed, else 0. */
  hiddenCount: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export interface ImageLayout {
  id: string;
  image: MapImage;
  rect: Rect;
}

export interface MapLayout {
  nodes: Map<NodeId, NodeLayout>;
  /** Visible node ids in pre-order (parents before children). */
  order: NodeId[];
  images: ImageLayout[];
  boundaries: BoundaryShape[];
  bounds: Rect;
}

export interface LayoutOptions {
  measure: MeasureWidth;
  /** Live text for the node being edited, so the map grows while typing. */
  editing?: { id: NodeId; text: string };
}

/** Where the branch from the parent arrives at this node. */
export function inAnchor(n: NodeLayout): Point {
  if (n.side === "root") return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
  return { x: n.side === "right" ? n.x : n.x + n.width, y: n.y + n.height };
}

/** Where branches to this node's children leave from. */
export function outAnchor(n: NodeLayout): Point {
  if (n.side === "root") return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
  return { x: n.side === "right" ? n.x + n.width : n.x, y: n.y + n.height };
}

/** Y of the node's branch line (underline), the reference line for stacking. */
function lineOffset(style: NodeStyle, height: number): number {
  return style.shape === "bubble" ? height / 2 : height;
}

interface Work {
  id: NodeId;
  depth: number;
  side: Side | "root";
  width: number;
  height: number;
  lines: string[];
  style: NodeStyle;
  /** Footprint (label + attached images) relative to the line point (label start x, line y). */
  fpTop: number;
  fpBottom: number;
  fpRight: number;
  fpLeft: number;
  kids: Work[];
  /** Child line-y offsets relative to this node's line y. */
  kidDy: number[];
  bandTop: number;
  bandBottom: number;
  boundary: boolean;
}

export function layoutMap(doc: MapDocument, opts: LayoutOptions): MapLayout {
  const imagesByNode = new Map<NodeId, MapImage[]>();
  for (const img of Object.values(doc.images)) {
    if (!img.nodeId) continue;
    const list = imagesByNode.get(img.nodeId) ?? [];
    list.push(img);
    imagesByNode.set(img.nodeId, list);
  }

  const sides = resolveTopLevelSides(doc);

  function build(id: NodeId, depth: number, side: Side | "root"): Work {
    const node = doc.nodes[id];
    const style = styleForDepth(depth);
    const text = opts.editing?.id === id ? opts.editing.text : node.text;
    const font = cssFont(style);
    const lines = wrapText(text, style.maxTextWidth, font, opts.measure);
    const textWidth = Math.max(...lines.map((l) => opts.measure(l, font)), 0);
    const width = Math.ceil(Math.max(style.minWidth, textWidth + style.padX * 2));
    const height = Math.ceil(lines.length * style.fontSize * style.lineHeight + style.padTop + style.padBottom);

    // Footprint relative to the line point: x from the label's start edge,
    // y from the branch line.
    const line = lineOffset(style, height);
    let fpTop = -line;
    let fpBottom = height - line;
    let fpLeft = 0;
    let fpRight = width;
    for (const img of imagesByNode.get(id) ?? []) {
      // Image x/y are relative to the label centre.
      const top = img.y + height / 2 - line;
      const left = img.x + width / 2;
      fpTop = Math.min(fpTop, top);
      fpBottom = Math.max(fpBottom, top + img.height);
      // For left-side nodes the label "start" is its right edge: mirror x.
      const l = side === "left" ? width - (left + img.width) : left;
      fpLeft = Math.min(fpLeft, l);
      fpRight = Math.max(fpRight, l + img.width);
    }

    const work: Work = {
      id,
      depth,
      side,
      width,
      height,
      lines,
      style,
      fpTop,
      fpBottom,
      fpLeft,
      fpRight,
      kids: [],
      kidDy: [],
      bandTop: fpTop,
      bandBottom: fpBottom,
      boundary: !!node.boundary,
    };
    if (!node.collapsed && side !== "root") {
      work.kids = node.children.map((c) => build(c, depth + 1, side));
      stack(work, node.children.length ? verticalGap(depth + 1) : 0);
    }
    if (work.boundary) {
      work.bandTop -= BOUNDARY_PAD;
      work.bandBottom += BOUNDARY_PAD;
    }
    return work;
  }

  /**
   * Stacks child bands and centres the span of their branch lines on the
   * parent's line, so a single child continues its parent's line straight on.
   */
  function stack(work: Work, gap: number) {
    const kids = work.kids;
    if (!kids.length) return;
    let cursor = 0;
    const dys = kids.map((k) => {
      const dy = cursor - k.bandTop;
      cursor += k.bandBottom - k.bandTop + gap;
      return dy;
    });
    const shift = -(dys[0] + dys[dys.length - 1]) / 2;
    work.kidDy = dys.map((d) => d + shift);
    const first = kids[0];
    const last = kids[kids.length - 1];
    work.bandTop = Math.min(work.fpTop, work.kidDy[0] + first.bandTop);
    work.bandBottom = Math.max(work.fpBottom, work.kidDy[kids.length - 1] + last.bandBottom);
  }

  const nodes = new Map<NodeId, NodeLayout>();

  function place(work: Work, parentId: NodeId | null, startX: number, lineY: number) {
    const node = doc.nodes[work.id];
    const line = lineOffset(work.style, work.height);
    // startX is the label's start edge (left edge on the right side, right edge on the left side).
    const x = work.side === "left" ? startX - work.width : work.side === "root" ? startX - work.width / 2 : startX;
    const layout: NodeLayout = {
      id: work.id,
      parentId,
      depth: work.depth,
      side: work.side,
      x,
      y: lineY - line,
      width: work.width,
      height: work.height,
      lines: work.lines,
      style: work.style,
      color: effectiveColor(doc, work.id),
      hiddenCount: node.collapsed ? countDescendants(doc, work.id) : 0,
      hasChildren: node.children.length > 0,
      collapsed: node.collapsed,
    };
    nodes.set(work.id, layout);

    const dir = work.side === "left" ? -1 : 1;
    // Children start beyond the footprint's far edge.
    work.kids.forEach((kid, i) => {
      const pad = kid.boundary ? BOUNDARY_PAD : 0;
      const kidStart = startX + dir * (work.fpRight + horizontalGap(work.depth) + pad - Math.min(0, kid.fpLeft));
      place(kid, work.id, kidStart, lineY + work.kidDy[i]);
    });
  }

  // Root: lay out each side as its own stack.
  const rootNode = doc.nodes[doc.rootId];
  const root = build(doc.rootId, 0, "root");
  place(root, null, 0, 0);
  if (!rootNode.collapsed) {
    for (const side of ["right", "left"] as Side[]) {
      const ids = rootNode.children.filter((c) => sides.get(c) === side);
      if (!ids.length) continue;
      const holder: Work = { ...root, kids: ids.map((c) => build(c, 1, side)), kidDy: [] };
      stack(holder, verticalGap(1));
      const dir = side === "left" ? -1 : 1;
      holder.kids.forEach((kid, i) => {
        const pad = kid.boundary ? BOUNDARY_PAD : 0;
        const start = dir * (root.width / 2 + horizontalGap(0) + pad - Math.min(0, kid.fpLeft));
        place(kid, doc.rootId, start, holder.kidDy[i]);
      });
    }
  }

  // Re-sort into pre-order following the document's child order.
  const sorted: NodeId[] = [];
  (function walk(id: NodeId) {
    if (!nodes.has(id)) return;
    sorted.push(id);
    for (const c of doc.nodes[id].children) walk(c);
  })(doc.rootId);

  const images: ImageLayout[] = [];
  for (const img of Object.values(doc.images)) {
    if (img.nodeId) {
      const owner = nodes.get(img.nodeId);
      if (!owner) continue; // hidden inside a collapsed branch
      const cx = owner.x + owner.width / 2;
      const cy = owner.y + owner.height / 2;
      images.push({ id: img.id, image: img, rect: { x: cx + img.x, y: cy + img.y, width: img.width, height: img.height } });
    } else {
      images.push({ id: img.id, image: img, rect: { x: img.x, y: img.y, width: img.width, height: img.height } });
    }
  }

  const boundaries = computeBoundaries(doc, nodes, sorted, images);
  return { nodes, order: sorted, images, boundaries, bounds: computeBounds(nodes, images, boundaries) };
}

function countDescendants(doc: MapDocument, id: NodeId): number {
  let n = 0;
  const stack = [...doc.nodes[id].children];
  while (stack.length) {
    const c = stack.pop()!;
    n++;
    stack.push(...doc.nodes[c].children);
  }
  return n;
}

export function computeBounds(
  nodes: Map<NodeId, NodeLayout>,
  images: ImageLayout[],
  boundaries: BoundaryShape[],
): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const n of nodes.values()) add(n.x, n.y, n.width, n.height + 4);
  for (const i of images) add(i.rect.x, i.rect.y, i.rect.width, i.rect.height);
  for (const b of boundaries) add(b.bounds.x, b.bounds.y, b.bounds.width, b.bounds.height);
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
