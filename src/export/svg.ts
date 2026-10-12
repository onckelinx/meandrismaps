/**
 * Self-contained SVG of the whole map (current collapse state), rendered with
 * the same MapScene component as the screen. Fonts and images are embedded so
 * the file looks identical anywhere. Also the source for PNG/JPEG and print.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getMeasurer } from "../canvas/useMapLayout";
import type { MapDocument } from "../document/model";
import { getAsset } from "../images/assetStore";
import { layoutMap, type MapLayout, type Rect } from "../layout/layout";
import { embeddedFontCss } from "../render/fonts";
import { MapScene } from "../render/MapScene";
import type { MapTheme } from "../render/theme";

export interface MapSvg {
  /** Complete SVG document. */
  svg: string;
  /** Just the drawing (for embedding several views of it, e.g. print pages). */
  content: string;
  fontCss: string;
  bounds: Rect;
  layout: MapLayout;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

export async function buildMapSvg(
  doc: MapDocument,
  opts: { theme: MapTheme; background: boolean; padding?: number },
): Promise<MapSvg> {
  const layout = layoutMap(doc, { measure: getMeasurer() });
  const pad = opts.padding ?? 40;
  const b = layout.bounds;
  const bounds = { x: Math.floor(b.x - pad), y: Math.floor(b.y - pad), width: Math.ceil(b.width + pad * 2), height: Math.ceil(b.height + pad * 2) };

  const urls = new Map<string, string>();
  for (const { image } of layout.images) {
    if (urls.has(image.assetId)) continue;
    const a = getAsset(image.assetId);
    if (a) urls.set(image.assetId, `data:${a.mime};base64,${base64(a.bytes)}`);
  }

  const text = [...layout.nodes.values()].map((n) => n.lines.join(" ")).join(" ");
  const fontCss = await embeddedFontCss(text);
  const content = renderToStaticMarkup(
    createElement(MapScene, { layout, theme: opts.theme, imageUrl: (id: string) => urls.get(id) }),
  );
  const bg = opts.background
    ? `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${opts.theme.background}"/>`
    : "";
  const title = escapeXml(doc.nodes[doc.rootId].text || "Mind map");
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" ` +
    `viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">` +
    `<title>${title}</title><defs><style>${fontCss}</style></defs>${bg}${content}</svg>\n`;
  return { svg, content, fontCss, bounds, layout };
}

const MAX_PIXELS = 120_000_000;
const MAX_SIDE = 16_000;

/** Largest usable scale not above `wanted` for a raster of this size. */
export function clampScale(width: number, height: number, wanted: number): number {
  const byArea = Math.sqrt(MAX_PIXELS / (width * height));
  const bySide = MAX_SIDE / Math.max(width, height);
  return Math.max(0.05, Math.min(wanted, byArea, bySide));
}

/** Rasterises an SVG document to PNG or JPEG bytes. */
export async function rasterize(
  map: MapSvg,
  opts: { format: "png" | "jpeg"; scale: number; fill?: string },
): Promise<{ bytes: Uint8Array; scale: number }> {
  const scale = clampScale(map.bounds.width, map.bounds.height, opts.scale);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([map.svg], { type: "image/svg+xml" }));
  try {
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(map.bounds.width * scale);
    canvas.height = Math.round(map.bounds.height * scale);
    const ctx = canvas.getContext("2d")!;
    if (opts.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = opts.format === "png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.92));
    if (!blob) throw new Error("The image could not be created (the map may be too large).");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), scale };
  } finally {
    URL.revokeObjectURL(url);
  }
}
