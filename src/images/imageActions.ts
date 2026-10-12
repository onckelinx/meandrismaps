/**
 * Image commands: insert free images, attach images to topics, detach,
 * paste and drop. Very large images are scaled down on import (longest edge
 * 4096 px) so maps stay fast and files stay portable.
 */
import { currentLayout } from "../canvas/MapCanvas";
import { screenToMap, viewStore } from "../canvas/viewport";
import { newAssetId, newImageId } from "../document/ids";
import type { MapImage, NodeId } from "../document/model";
import * as ops from "../document/ops";
import { selectedNodeId } from "../state/actions";
import { apply, getState } from "../state/store";
import { platform } from "../platform";
import { notify, showError } from "../ui/dialogs";
import { registerCommands } from "../app/commands";
import { setImagePasteHandler } from "../app/clipboard";
import { putAsset } from "./assetStore";

const MAX_EDGE = 4096;
const IMAGE_FILTER = { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] };

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

export function mimeFromName(name: string): string | undefined {
  return MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""];
}

interface Prepared {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

async function naturalSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth || 300, height: img.naturalHeight || 200 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decodes an image, measuring it and scaling it down if it is huge. */
export async function prepareImage(bytes: Uint8Array, mime: string): Promise<Prepared> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const { width, height } = await naturalSize(blob);
  if (mime === "image/svg+xml" || mime === "image/gif" || Math.max(width, height) <= MAX_EDGE) {
    return { bytes, mime, width, height };
  }
  const scale = MAX_EDGE / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const bitmap = await createImageBitmap(blob);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const outMime = mime === "image/jpeg" ? "image/jpeg" : "image/png";
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, outMime, 0.92));
  if (!out) return { bytes, mime, width, height };
  return { bytes: new Uint8Array(await out.arrayBuffer()), mime: outMime, width: canvas.width, height: canvas.height };
}

function fitSize(w: number, h: number, maxW: number, maxH: number) {
  const s = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

function registerAsset(p: Prepared): string {
  const assetId = newAssetId();
  putAsset(assetId, p.bytes, p.mime);
  return assetId;
}

/** Adds a free image centred on a map point. */
export function addFreeImage(p: Prepared, at: { x: number; y: number }) {
  const assetId = registerAsset(p);
  const size = fitSize(p.width, p.height, 320, 240);
  const image: MapImage = { id: newImageId(), assetId, x: at.x - size.width / 2, y: at.y - size.height / 2, ...size };
  apply(
    "Insert Image",
    (d) => {
      ops.addAsset(d, { id: assetId, mime: p.mime, width: p.width, height: p.height });
      ops.addImage(d, image);
    },
    { select: { kind: "image", id: image.id } },
  );
}

/** Attaches a new image to a topic, placed just above its label. */
export function addAttachedImage(p: Prepared, nodeId: NodeId) {
  const assetId = registerAsset(p);
  const size = fitSize(p.width, p.height, 180, 140);
  const n = currentLayout?.nodes.get(nodeId);
  const labelH = n?.height ?? 30;
  const image: MapImage = {
    id: newImageId(),
    assetId,
    nodeId,
    x: -size.width / 2,
    y: -labelH / 2 - size.height - 6,
    ...size,
  };
  apply(
    "Attach Image",
    (d) => {
      ops.addAsset(d, { id: assetId, mime: p.mime, width: p.width, height: p.height });
      ops.addImage(d, image);
    },
    { select: { kind: "image", id: image.id } },
  );
}

function viewCenter() {
  const v = viewStore.getState();
  return screenToMap(v.width / 2, v.height / 2);
}

async function pickImage(): Promise<Prepared | null> {
  const path = await platform.openDialog([IMAGE_FILTER], "Choose an Image");
  if (!path) return null;
  const mime = mimeFromName(path);
  if (!mime) {
    await showError("Unsupported image", "Choose a PNG, JPEG, GIF, WebP, SVG or BMP image.");
    return null;
  }
  try {
    return await prepareImage(await platform.readFile(path), mime);
  } catch {
    await showError("The image could not be opened", "The file may be damaged or in an unsupported format.");
    return null;
  }
}

/** The view centre, or just below the map if the centre is already covered by it. */
function freeSpot(size: { width: number; height: number }) {
  const c = viewCenter();
  const b = currentLayout?.bounds;
  if (!b) return c;
  const overlaps =
    c.x + size.width / 2 > b.x && c.x - size.width / 2 < b.x + b.width &&
    c.y + size.height / 2 > b.y && c.y - size.height / 2 < b.y + b.height;
  return overlaps ? { x: c.x, y: b.y + b.height + 40 + size.height / 2 } : c;
}

export async function insertImageFromFile() {
  const p = await pickImage();
  if (p) addFreeImage(p, freeSpot(fitSize(p.width, p.height, 320, 240)));
}

export async function attachImageFromFile(nodeId?: NodeId) {
  const id = nodeId ?? selectedNodeId();
  if (!id) return;
  const p = await pickImage();
  if (p) addAttachedImage(p, id);
}

/** Pasted or dropped image files. Attaches to `nodeId` when given, otherwise free at `at`. */
export async function insertImageFiles(files: File[], opts: { nodeId?: NodeId | null; at?: { x: number; y: number } }) {
  for (const [i, file] of files.entries()) {
    const mime = file.type || mimeFromName(file.name);
    if (!mime?.startsWith("image/")) continue;
    try {
      const p = await prepareImage(new Uint8Array(await file.arrayBuffer()), mime);
      if (opts.nodeId) addAttachedImage(p, opts.nodeId);
      else {
        const at = opts.at ?? freeSpot(fitSize(p.width, p.height, 320, 240));
        addFreeImage(p, { x: at.x + i * 24, y: at.y + i * 24 });
      }
    } catch {
      notify(`“${file.name || "Image"}” could not be read.`, "error");
    }
  }
}

function selectedImage(): MapImage | null {
  const sel = getState().selection;
  return sel?.kind === "image" ? (getState().doc.images[sel.id] ?? null) : null;
}

export function detachSelectedImage() {
  const img = selectedImage();
  const layout = currentLayout;
  if (!img?.nodeId || !layout) return;
  const rect = layout.images.find((i) => i.id === img.id)?.rect;
  if (!rect) return;
  apply("Detach Image", (d) => ops.detachImage(d, img.id, rect.x, rect.y));
}

export function attachSelectedImageToNearest() {
  const img = selectedImage();
  const layout = currentLayout;
  if (!img || img.nodeId || !layout) return;
  const cx = img.x + img.width / 2;
  const cy = img.y + img.height / 2;
  let best: { id: NodeId; d: number; nx: number; ny: number } | null = null;
  for (const n of layout.nodes.values()) {
    const nx = n.x + n.width / 2;
    const ny = n.y + n.height / 2;
    const d = Math.hypot(nx - cx, ny - cy);
    if (!best || d < best.d) best = { id: n.id, d, nx, ny };
  }
  if (!best) return;
  const b = best;
  apply("Attach Image", (d) => ops.attachImage(d, img.id, b.id, img.x - b.nx, img.y - b.ny));
}

export function resetSelectedImageSize() {
  const img = selectedImage();
  if (!img) return;
  const asset = getState().doc.assets[img.assetId];
  if (!asset?.width) return;
  const size = img.nodeId ? fitSize(asset.width, asset.height, 180, 140) : fitSize(asset.width, asset.height, 320, 240);
  const cx = img.x + img.width / 2;
  const cy = img.y + img.height / 2;
  apply("Reset Image Size", (d) => ops.updateImage(d, img.id, { ...size, x: cx - size.width / 2, y: cy - size.height / 2 }));
}

/** Handles files dragged from the desktop onto the canvas. */
export function installImageDrop(target: HTMLElement): () => void {
  const over = (e: DragEvent) => {
    if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    }
  };
  const drop = (e: DragEvent) => {
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => (f.type || mimeFromName(f.name))?.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    const at = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
    // Dropping onto a topic attaches the image to it.
    let nodeId: NodeId | null = null;
    for (const n of currentLayout?.nodes.values() ?? []) {
      if (at.x >= n.x && at.x <= n.x + n.width && at.y >= n.y && at.y <= n.y + n.height) nodeId = n.id;
    }
    void insertImageFiles(files, { nodeId, at });
  };
  target.addEventListener("dragover", over);
  target.addEventListener("drop", drop);
  return () => {
    target.removeEventListener("dragover", over);
    target.removeEventListener("drop", drop);
  };
}

setImagePasteHandler((files) => void insertImageFiles(files, { nodeId: selectedNodeId() }));

registerCommands([
  { id: "image.insert", label: "Image…", keys: ["Mod+Shift+I"], global: true, run: insertImageFromFile },
  {
    id: "image.attach",
    label: "Attach Image to Topic…",
    enabled: () => selectedNodeId() !== null,
    run: () => attachImageFromFile(),
  },
  { id: "image.detach", label: "Detach from Topic", enabled: () => !!selectedImage()?.nodeId, run: detachSelectedImage },
  {
    id: "image.attachNearest",
    label: "Attach to Nearest Topic",
    enabled: () => !!selectedImage() && !selectedImage()!.nodeId,
    run: attachSelectedImageToNearest,
  },
  { id: "image.resetSize", label: "Reset Size", enabled: () => !!selectedImage(), run: resetSelectedImageSize },
]);
