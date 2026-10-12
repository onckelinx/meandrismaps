/** Typography and spacing per depth. Shared by layout, rendering and export. */

export const FONT_FAMILY = `"Inter Variable", "Inter", system-ui, sans-serif`;

export interface NodeStyle {
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  maxTextWidth: number;
  padX: number;
  padTop: number;
  padBottom: number;
  /** Minimum label width (so empty nodes stay visible while editing). */
  minWidth: number;
  /** Width of the branch where it reaches this node (and of its underline). */
  lineWidth: number;
  /** "bubble" for the root, "underline" for everything else. */
  shape: "bubble" | "underline";
}

const ROOT: NodeStyle = {
  fontSize: 22,
  fontWeight: 650,
  lineHeight: 1.25,
  maxTextWidth: 280,
  padX: 22,
  padTop: 14,
  padBottom: 14,
  minWidth: 120,
  lineWidth: 0,
  shape: "bubble",
};

const LEVEL1: NodeStyle = {
  fontSize: 17,
  fontWeight: 600,
  lineHeight: 1.25,
  maxTextWidth: 240,
  padX: 6,
  padTop: 4,
  padBottom: 8,
  minWidth: 56,
  lineWidth: 4.5,
  shape: "underline",
};

const LEVEL2: NodeStyle = {
  fontSize: 14.5,
  fontWeight: 500,
  lineHeight: 1.3,
  maxTextWidth: 220,
  padX: 5,
  padTop: 3,
  padBottom: 6,
  minWidth: 44,
  lineWidth: 2.5,
  shape: "underline",
};

const DEEPER: NodeStyle = { ...LEVEL2, fontWeight: 450, lineWidth: 1.6 };

export function styleForDepth(depth: number): NodeStyle {
  if (depth === 0) return ROOT;
  if (depth === 1) return LEVEL1;
  if (depth === 2) return LEVEL2;
  return DEEPER;
}

/** Width of the branch where it leaves its parent. */
export function branchStartWidth(parentDepth: number): number {
  if (parentDepth === 0) return 14;
  return styleForDepth(parentDepth).lineWidth;
}

/** Horizontal distance between a parent's outgoing edge and a child's label. */
export function horizontalGap(parentDepth: number): number {
  return parentDepth === 0 ? 72 : 42;
}

/** Vertical gap between sibling subtrees. */
export function verticalGap(childDepth: number): number {
  return childDepth === 1 ? 22 : 8;
}

export const BOUNDARY_PAD = 14;

export function cssFont(style: NodeStyle): string {
  return `${style.fontWeight} ${style.fontSize}px ${FONT_FAMILY}`;
}
