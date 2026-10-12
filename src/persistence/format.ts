/**
 * The native `.meandrismap` format: a ZIP container with
 *
 *   mimetype            "application/x-meandris-map" (stored, first entry)
 *   map.json            the document (see docs/FILE_FORMAT.md)
 *   assets/<id>.<ext>   embedded image files
 *
 * Reading is defensive: damaged files fail with a readable message, and
 * repairable problems are fixed with a warning rather than losing content.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { AssetInfo, Boundary, MapDocument, MapImage, MapNode, NodeId, Side } from "../document/model";
import { checkInvariants } from "../document/ops";

export const FORMAT_NAME = "meandris-map";
export const FORMAT_VERSION = 1;
export const MIME_TYPE = "application/x-meandris-map";
export const FILE_EXTENSION = "meandrismap";

export class MapFileError extends Error {}

interface FileNode {
  id: string;
  text: string;
  parent: string | null;
  children: string[];
  collapsed?: boolean;
  color?: string;
  boundary?: Boundary;
  side?: Side;
}

interface FileImage {
  id: string;
  asset: string;
  node?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FileAsset {
  id: string;
  path: string;
  mime: string;
  width: number;
  height: number;
}

export interface MapFileJson {
  format: string;
  version: number;
  generator?: string;
  document: { root: string; created?: string; modified?: string };
  settings?: { layout?: string };
  nodes: FileNode[];
  images?: FileImage[];
  assets?: FileAsset[];
}

export interface AssetBytes {
  bytes: Uint8Array;
  mime: string;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

export function extensionForMime(mime: string): string {
  return EXT[mime] ?? "bin";
}

/** Builds the JSON representation (exposed for tests and docs). */
export function toFileJson(doc: MapDocument, generator: string): MapFileJson {
  const nodes: FileNode[] = [];
  const walk = (id: NodeId) => {
    const n = doc.nodes[id];
    const fn: FileNode = { id: n.id, text: n.text, parent: n.parentId, children: [...n.children] };
    if (n.collapsed) fn.collapsed = true;
    if (n.color) fn.color = n.color;
    if (n.boundary) fn.boundary = { ...n.boundary };
    if (n.side && n.parentId === doc.rootId) fn.side = n.side;
    nodes.push(fn);
    n.children.forEach(walk);
  };
  walk(doc.rootId);
  const images: FileImage[] = Object.values(doc.images).map((i) => {
    const fi: FileImage = { id: i.id, asset: i.assetId, x: i.x, y: i.y, width: i.width, height: i.height };
    if (i.nodeId) fi.node = i.nodeId;
    return fi;
  });
  const used = new Set(images.map((i) => i.asset));
  const assets: FileAsset[] = Object.values(doc.assets)
    .filter((a) => used.has(a.id))
    .map((a) => ({
      id: a.id,
      path: `assets/${a.id}.${extensionForMime(a.mime)}`,
      mime: a.mime,
      width: a.width,
      height: a.height,
    }));
  return {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    generator,
    document: { root: doc.rootId, created: doc.meta.created, modified: new Date().toISOString() },
    settings: { layout: doc.settings.layout },
    nodes,
    images,
    assets,
  };
}

export function serializeMap(
  doc: MapDocument,
  getAsset: (id: string) => AssetBytes | undefined,
  opts: { generator?: string; extraFiles?: Record<string, Uint8Array> } = {},
): Uint8Array {
  const json = toFileJson(doc, opts.generator ?? "Meandris Maps");
  const files: Zippable = {
    mimetype: [strToU8(MIME_TYPE), { level: 0 }],
    "map.json": [strToU8(JSON.stringify(json, null, 2)), { level: 6 }],
  };
  for (const a of json.assets ?? []) {
    const bytes = getAsset(a.id)?.bytes;
    // Images are already compressed; store them as-is.
    if (bytes) files[a.path] = [bytes, { level: 0 }];
  }
  for (const [name, bytes] of Object.entries(opts.extraFiles ?? {})) files[name] = [bytes, { level: 6 }];
  return zipSync(files);
}

export interface ParsedMap {
  doc: MapDocument;
  assets: Map<string, AssetBytes>;
  warnings: string[];
  /** Other files in the container (e.g. recovery metadata). */
  extraFiles: Record<string, Uint8Array>;
}

const NOT_A_MAP = "This file is not a Meandris Maps document, or it is damaged.";

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isColor = (v: unknown): v is string => isStr(v) && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

export function parseMap(bytes: Uint8Array): ParsedMap {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new MapFileError(NOT_A_MAP);
  }
  const mapJson = entries["map.json"];
  if (!mapJson) throw new MapFileError(NOT_A_MAP);
  let raw: MapFileJson;
  try {
    raw = JSON.parse(strFromU8(mapJson));
  } catch {
    throw new MapFileError("This map file is damaged: its contents could not be read.");
  }
  if (!raw || typeof raw !== "object" || raw.format !== FORMAT_NAME) throw new MapFileError(NOT_A_MAP);
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    throw new MapFileError("This map file is damaged: it has an invalid format version.");
  }
  if (raw.version > FORMAT_VERSION) {
    throw new MapFileError(
      `This map was saved by a newer version of Meandris Maps (file format ${raw.version}). ` +
        `Please update Meandris Maps to open it.`,
    );
  }
  if (!Array.isArray(raw.nodes) || !raw.document || !isStr(raw.document.root)) {
    throw new MapFileError("This map file is damaged: it has no map structure.");
  }

  const warnings: string[] = [];
  const fileNodes = new Map<string, FileNode>();
  for (const n of raw.nodes) {
    if (!n || !isStr(n.id) || fileNodes.has(n.id)) continue;
    fileNodes.set(n.id, n);
  }
  const rootId = raw.document.root;
  if (!fileNodes.has(rootId)) throw new MapFileError("This map file is damaged: its central topic is missing.");

  // Rebuild the tree from the root, trusting `children` for structure and order.
  const nodes: Record<NodeId, MapNode> = {};
  let dropped = 0;
  const build = (id: string, parentId: string | null) => {
    const f = fileNodes.get(id)!;
    const node: MapNode = {
      id,
      text: isStr(f.text) ? f.text : "",
      parentId,
      children: [],
      collapsed: f.collapsed === true,
    };
    if (isColor(f.color)) node.color = f.color;
    if (f.boundary && typeof f.boundary === "object") {
      const b: Boundary = {};
      if (isColor(f.boundary.fill)) b.fill = f.boundary.fill;
      if (isColor(f.boundary.stroke)) b.stroke = f.boundary.stroke;
      node.boundary = b;
    }
    if (parentId === rootId && (f.side === "left" || f.side === "right")) node.side = f.side;
    nodes[id] = node;
    for (const c of Array.isArray(f.children) ? f.children : []) {
      if (!isStr(c) || !fileNodes.has(c) || nodes[c] || c === rootId) {
        dropped++;
        continue;
      }
      node.children.push(c);
      build(c, id);
    }
  };
  build(rootId, null);
  if (dropped) warnings.push(`${dropped} broken link(s) in the map structure were repaired.`);

  // Nodes not reachable from the root are re-attached under it rather than lost.
  const orphans = [...fileNodes.keys()].filter((id) => !nodes[id]);
  const orphanRoots = orphans.filter((id) => {
    const p = fileNodes.get(id)!.parent;
    return !(isStr(p) && orphans.includes(p) && fileNodes.get(p)!.children?.includes(id));
  });
  for (const id of orphanRoots) {
    if (nodes[id]) continue;
    nodes[rootId].children.push(id);
    build(id, rootId);
  }
  if (orphanRoots.length) {
    warnings.push(`${orphanRoots.length} detached topic(s) were found and re-attached to the central topic.`);
  }

  const assets: Record<string, AssetInfo> = {};
  const assetBytes = new Map<string, AssetBytes>();
  for (const a of Array.isArray(raw.assets) ? raw.assets : []) {
    if (!a || !isStr(a.id) || !isStr(a.mime)) continue;
    assets[a.id] = { id: a.id, mime: a.mime, width: isNum(a.width) ? a.width : 0, height: isNum(a.height) ? a.height : 0 };
    const bytes = isStr(a.path) ? entries[a.path] : undefined;
    if (bytes) assetBytes.set(a.id, { bytes, mime: a.mime });
  }

  const images: Record<string, MapImage> = {};
  let missingImages = 0;
  for (const i of Array.isArray(raw.images) ? raw.images : []) {
    if (!i || !isStr(i.id) || !isStr(i.asset)) continue;
    if (![i.x, i.y, i.width, i.height].every(isNum) || i.width <= 0 || i.height <= 0) continue;
    if (!assets[i.asset]) assets[i.asset] = { id: i.asset, mime: "application/octet-stream", width: 0, height: 0 };
    if (!assetBytes.has(i.asset)) missingImages++;
    const img: MapImage = { id: i.id, assetId: i.asset, x: i.x, y: i.y, width: i.width, height: i.height };
    if (isStr(i.node) && nodes[i.node]) img.nodeId = i.node;
    else if (isStr(i.node)) {
      // Attached to a topic that no longer exists: keep it as a free image.
      warnings.push("An image attached to a missing topic was kept as a free image.");
    }
    images[i.id] = img;
  }
  if (missingImages) warnings.push(`${missingImages} image(s) could not be found in the file and are shown as placeholders.`);

  const now = new Date().toISOString();
  const doc: MapDocument = {
    rootId,
    nodes,
    images,
    assets,
    settings: { layout: raw.settings?.layout === "right" ? "right" : "both" },
    meta: {
      created: isStr(raw.document.created) ? raw.document.created : now,
      modified: isStr(raw.document.modified) ? raw.document.modified : now,
    },
  };
  // Collapsed flags on leaves are meaningless; normalise them.
  for (const n of Object.values(doc.nodes)) if (!n.children.length) n.collapsed = false;

  const problems = checkInvariants(doc).filter((p) => !p.includes("missing asset"));
  if (problems.length) throw new MapFileError("This map file is damaged and could not be repaired.");

  const extraFiles: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name !== "mimetype" && name !== "map.json" && !name.startsWith("assets/")) extraFiles[name] = data;
  }
  return { doc, assets: assetBytes, warnings: [...new Set(warnings)], extraFiles };
}
