/**
 * Image bytes, keyed by asset id. Kept out of the (undoable) document: assets
 * are immutable, and an undone deletion simply refers to the bytes again.
 */
export interface StoredAsset {
  bytes: Uint8Array;
  mime: string;
  url: string;
  /** Downscaled preview for small on-screen sizes. */
  thumbUrl?: string;
  thumbWidth?: number;
}

const assets = new Map<string, StoredAsset>();
const listeners = new Set<() => void>();

export function putAsset(id: string, bytes: Uint8Array, mime: string): StoredAsset {
  const existing = assets.get(id);
  if (existing) return existing;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const stored: StoredAsset = { bytes, mime, url };
  assets.set(id, stored);
  void makeThumbnail(stored).then(() => listeners.forEach((l) => l()));
  return stored;
}

export function getAsset(id: string): StoredAsset | undefined {
  return assets.get(id);
}

export function clearAssets() {
  for (const a of assets.values()) {
    URL.revokeObjectURL(a.url);
    if (a.thumbUrl) URL.revokeObjectURL(a.thumbUrl);
  }
  assets.clear();
}

export function onAssetsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const THUMB_SIZE = 480;

async function makeThumbnail(a: StoredAsset) {
  try {
    const bitmap = await createImageBitmap(new Blob([a.bytes as BlobPart], { type: a.mime }));
    const scale = THUMB_SIZE / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) {
      bitmap.close();
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return;
    a.thumbUrl = URL.createObjectURL(blob);
    a.thumbWidth = canvas.width;
  } catch {
    // Decoding failed; the full image (or a placeholder) is used instead.
  }
}

/** URL for displaying an asset at roughly `screenWidth` CSS pixels. */
export function displayUrl(id: string, screenWidth: number): string | undefined {
  const a = assets.get(id);
  if (!a) return undefined;
  if (a.thumbUrl && a.thumbWidth && screenWidth * (window.devicePixelRatio || 1) <= a.thumbWidth) return a.thumbUrl;
  return a.url;
}
