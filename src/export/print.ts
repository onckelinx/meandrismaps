/**
 * Printing. The map (not a screenshot of the viewport) is laid out onto
 * pages: either scaled to fit one page, or tiled across several pages at a
 * chosen scale. Pages are real DOM shown only to the printer (@media print).
 */
import type { Rect } from "../layout/layout";

export type Paper = "a4" | "letter" | "a3";
export type Orientation = "auto" | "portrait" | "landscape";

export interface PrintOptions {
  paper: Paper;
  orientation: Orientation;
  /** "fit" = whole map on one page; "tile" = split across pages at `scale`. */
  mode: "fit" | "tile";
  /** Percentage of on-screen size (100 = 1 map unit is 1 CSS pixel). */
  scale: number;
  marginMm: number;
}

export const PAPER_MM: Record<Paper, { w: number; h: number; label: string }> = {
  a4: { w: 210, h: 297, label: "A4" },
  letter: { w: 215.9, h: 279.4, label: "US Letter" },
  a3: { w: 297, h: 420, label: "A3" },
};

const MM_PER_PX = 25.4 / 96;

export interface PrintPlan {
  pageW: number;
  pageH: number;
  landscape: boolean;
  /** Map region printed on each page (map units), row by row. */
  tiles: Rect[];
  cols: number;
  rows: number;
  /** Millimetres per map unit. */
  mmPerUnit: number;
}

export function planPrint(bounds: Rect, o: PrintOptions): PrintPlan {
  const paper = PAPER_MM[o.paper];
  const landscape = o.orientation === "landscape" || (o.orientation === "auto" && bounds.width > bounds.height);
  const pageW = landscape ? paper.h : paper.w;
  const pageH = landscape ? paper.w : paper.h;
  const areaW = pageW - o.marginMm * 2;
  const areaH = pageH - o.marginMm * 2;
  if (o.mode === "fit") {
    const mmPerUnit = Math.min(areaW / bounds.width, areaH / bounds.height);
    return { pageW, pageH, landscape, tiles: [bounds], cols: 1, rows: 1, mmPerUnit };
  }
  const mmPerUnit = MM_PER_PX * (o.scale / 100);
  const tileW = areaW / mmPerUnit;
  const tileH = areaH / mmPerUnit;
  const cols = Math.max(1, Math.ceil(bounds.width / tileW - 1e-6));
  const rows = Math.max(1, Math.ceil(bounds.height / tileH - 1e-6));
  // Centre the map within the tiled area.
  const ox = bounds.x - (cols * tileW - bounds.width) / 2;
  const oy = bounds.y - (rows * tileH - bounds.height) / 2;
  const tiles: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.push({ x: ox + c * tileW, y: oy + r * tileH, width: tileW, height: tileH });
  }
  return { pageW, pageH, landscape, tiles, cols, rows, mmPerUnit };
}

/** Builds the print-only DOM for a plan. Replaces any previous print job. */
export function preparePrintDom(plan: PrintPlan, map: { content: string; fontCss: string; bounds: Rect }, o: PrintOptions) {
  document.getElementById("print-root")?.remove();
  document.getElementById("print-style")?.remove();

  const style = document.createElement("style");
  style.id = "print-style";
  style.textContent =
    `${map.fontCss}\n` +
    `@page { size: ${plan.pageW}mm ${plan.pageH}mm; margin: 0; }\n` +
    `@media screen { #print-root { display: none; } }\n` +
    `@media print {\n` +
    `  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }\n` +
    `  body > :not(#print-root) { display: none !important; }\n` +
    `  #print-root { display: block; }\n` +
    `  .print-page { width: ${plan.pageW}mm; height: ${plan.pageH}mm; padding: ${o.marginMm}mm; box-sizing: border-box;` +
    ` break-after: page; page-break-after: always; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n` +
    `  .print-page:last-child { break-after: auto; page-break-after: auto; }\n` +
    `  .print-page svg { display: block; width: 100%; height: 100%; }\n` +
    `}\n`;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "print-root";
  const defs =
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true">` +
    `<defs><g id="print-map">${map.content}</g></defs></svg>`;
  const pages = plan.tiles
    .map(
      (t) =>
        `<div class="print-page"><svg xmlns="http://www.w3.org/2000/svg" ` +
        `viewBox="${t.x} ${t.y} ${t.width} ${t.height}" preserveAspectRatio="xMidYMid meet">` +
        `<use href="#print-map"/></svg></div>`,
    )
    .join("");
  root.innerHTML = defs + pages;
  document.body.appendChild(root);
}
