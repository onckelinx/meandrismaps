/**
 * Document lifecycle: New / Open / Save / Save As, unsaved-change protection,
 * recent files, and background recovery snapshots.
 *
 * Normal file semantics are never undermined: the user's file is only written
 * on an explicit save. Recovery snapshots live in the app's data directory and
 * are removed once the work is saved or deliberately discarded.
 */
import { strFromU8, strToU8 } from "fflate";
import { createStore } from "zustand";
import { newAssetId } from "../document/ids";
import type { MapDocument } from "../document/model";
import { createDocument } from "../document/ops";
import { clearAssets, getAsset, putAsset } from "../images/assetStore";
import { FILE_EXTENSION, MapFileError, parseMap, serializeMap } from "../persistence/format";
import { baseName, platform } from "../platform";
import { commitEditing, startEditing } from "../state/actions";
import { editorStore, getState, isDirty, loadDocument, markSaved } from "../state/store";
import { notify, showDialog, showError } from "../ui/dialogs";
import { fitMap } from "./mapCommands";

export const MAP_FILTER = { name: "Meandris Map", extensions: [FILE_EXTENSION] };
const AUTOSAVE_MS = 15000;
const RECENT_KEY = "meandrismaps.recent";
const MAX_RECENT = 10;

let recoveryId = newRecoveryId();

function newRecoveryId() {
  return `r_${Date.now().toString(36)}_${newAssetId().slice(2, 8)}`;
}

export const recentStore = createStore<{ recent: string[] }>(() => ({ recent: loadRecent() }));

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function addRecent(path: string) {
  if (platform.kind !== "tauri") return;
  const recent = [path, ...recentStore.getState().recent.filter((p) => p !== path)].slice(0, MAX_RECENT);
  recentStore.setState({ recent });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // storage unavailable
  }
}

export function clearRecent() {
  recentStore.setState({ recent: [] });
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // storage unavailable
  }
}

export function documentName(): string {
  const s = getState();
  if (s.filePath) return baseName(s.filePath).replace(new RegExp(`\\.${FILE_EXTENSION}$`), "");
  return "Untitled";
}

function suggestedFileName(): string {
  const root = getState().doc.nodes[getState().doc.rootId].text;
  const clean = root.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").trim().slice(0, 60);
  return `${clean || documentName()}.${FILE_EXTENSION}`;
}

export function updateTitle() {
  const dirty = isDirty();
  platform.setTitle(`${dirty ? "• " : ""}${documentName()} — Meandris Maps`);
  (window as unknown as { __meandrisDirty?: boolean }).__meandrisDirty = dirty;
}

function serializeCurrent(extraFiles?: Record<string, Uint8Array>): Uint8Array {
  return serializeMap(getState().doc, (id) => getAsset(id), {
    generator: `Meandris Maps ${__APP_VERSION__}`,
    extraFiles,
  });
}

// --- Saving -------------------------------------------------------------------

export async function saveMap(): Promise<boolean> {
  commitEditing();
  const path = getState().filePath;
  if (!path) return saveMapAs();
  return writeTo(path);
}

export async function saveMapAs(): Promise<boolean> {
  commitEditing();
  let path = await platform.saveDialog(suggestedFileName(), [MAP_FILTER], "Save Map");
  if (!path) return false;
  if (!path.toLowerCase().endsWith(`.${FILE_EXTENSION}`)) path += `.${FILE_EXTENSION}`;
  return writeTo(path);
}

async function writeTo(path: string): Promise<boolean> {
  const before = getState().past[getState().past.length - 1];
  try {
    await platform.writeFile(path, serializeCurrent());
  } catch (e) {
    await showError("The map could not be saved", `${baseName(path)}: ${errorText(e)}`);
    return false;
  }
  // Only mark saved if nothing changed while writing.
  if (getState().past[getState().past.length - 1] === before) markSaved(path);
  else editorStore.setState({ filePath: path });
  addRecent(path);
  void platform.recoveryDelete(recoveryId).catch(() => {});
  updateTitle();
  return true;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Asks what to do with unsaved changes. Resolves true when it is OK to
 * continue (saved or discarded), false when the user cancelled.
 */
export async function confirmUnsavedChanges(): Promise<boolean> {
  commitEditing();
  if (!isDirty()) return true;
  const choice = await showDialog({
    title: `Do you want to save the changes to “${documentName()}”?`,
    message: "Your changes will be lost if you don't save them.",
    buttons: [
      { id: "discard", label: "Don't Save", danger: true },
      { id: "cancel", label: "Cancel" },
      { id: "save", label: "Save", primary: true },
    ],
    cancelId: "cancel",
  });
  if (choice === "cancel") return false;
  if (choice === "save") return saveMap();
  return true;
}

// --- New / Open -----------------------------------------------------------------

function replaceDocument(doc: MapDocument, path: string | null, dirty = false) {
  void platform.recoveryDelete(recoveryId).catch(() => {});
  recoveryId = newRecoveryId();
  lastSnapshotRevision = -1;
  loadDocument(doc, path, dirty);
  updateTitle();
}

export async function newMap() {
  if (!(await confirmUnsavedChanges())) return;
  clearAssets();
  replaceDocument(createDocument(), null);
  startEditing(getState().doc.rootId);
}

export async function openMap() {
  if (!(await confirmUnsavedChanges())) return;
  const path = await platform.openDialog([MAP_FILTER], "Open Map");
  if (path) await openPath(path, { skipConfirm: true });
}

/** Opens a map file. Returns true on success. */
export async function openPath(path: string, opts: { skipConfirm?: boolean } = {}): Promise<boolean> {
  if (!opts.skipConfirm && !(await confirmUnsavedChanges())) return false;
  let bytes: Uint8Array;
  try {
    bytes = await platform.readFile(path);
  } catch (e) {
    await showError(`“${baseName(path)}” could not be opened`, `The file could not be read: ${errorText(e)}`);
    return false;
  }
  try {
    const parsed = parseMap(bytes);
    clearAssets();
    for (const [id, a] of parsed.assets) putAsset(id, a.bytes, a.mime);
    replaceDocument(parsed.doc, path);
    addRecent(path);
    fitAfterLoad();
    if (parsed.warnings.length) notify(parsed.warnings.join(" "), "warning");
    return true;
  } catch (e) {
    const message = e instanceof MapFileError ? e.message : `Unexpected error: ${errorText(e)}`;
    await showError(`“${baseName(path)}” could not be opened`, message);
    return false;
  }
}

/** Loads a document created by an import (e.g. Markdown) as a new, unsaved map. */
export function loadImported(doc: MapDocument) {
  clearAssets();
  replaceDocument(doc, null, true);
  fitAfterLoad();
}

function fitAfterLoad() {
  requestAnimationFrame(() => requestAnimationFrame(() => fitMap(false, 1)));
}

// --- Closing ------------------------------------------------------------------------

export async function handleCloseRequest(): Promise<boolean> {
  if (!(await confirmUnsavedChanges())) return false;
  await platform.recoveryDelete(recoveryId).catch(() => {});
  return true;
}

// --- Recovery ---------------------------------------------------------------------

let lastSnapshotRevision = -1;

async function writeSnapshot() {
  const s = getState();
  if (!isDirty() || s.revision === lastSnapshotRevision) return;
  lastSnapshotRevision = s.revision;
  const meta = { filePath: s.filePath, name: documentName(), savedAt: Date.now() };
  try {
    await platform.recoveryWrite(recoveryId, serializeCurrent({ "recovery.json": strToU8(JSON.stringify(meta)) }));
  } catch {
    // Recovery is best-effort; never interrupt the user for it.
  }
}

export function startAutosave(): () => void {
  const timer = setInterval(() => void writeSnapshot(), AUTOSAVE_MS);
  const onHide = () => {
    if (document.visibilityState === "hidden") void writeSnapshot();
  };
  document.addEventListener("visibilitychange", onHide);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
  };
}

/** Offers to restore unsaved work left behind by a crash. Returns true if a map was restored. */
export async function offerRecovery(): Promise<boolean> {
  let entries;
  try {
    entries = await platform.recoveryList();
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.id === recoveryId) continue;
    let parsed;
    try {
      parsed = parseMap(await platform.recoveryRead(entry.id));
    } catch {
      await platform.recoveryDelete(entry.id).catch(() => {});
      continue;
    }
    let meta: { filePath?: string | null; name?: string } = {};
    try {
      meta = JSON.parse(strFromU8(parsed.extraFiles["recovery.json"] ?? strToU8("{}")));
    } catch {
      // metadata is optional
    }
    const when = new Date(entry.modified).toLocaleString();
    const choice = await showDialog({
      title: `Recover unsaved changes to “${meta.name ?? "Untitled"}”?`,
      message: `Meandris Maps found unsaved work from ${when} that was not closed normally.`,
      buttons: [
        { id: "discard", label: "Discard", danger: true },
        { id: "recover", label: "Recover", primary: true },
      ],
      cancelId: "discard",
    });
    if (choice === "recover") {
      await platform.recoveryClaim(entry.id).catch(() => {});
      clearAssets();
      for (const [id, a] of parsed.assets) putAsset(id, a.bytes, a.mime);
      // Keep writing snapshots to the same recovery slot until saved.
      loadDocument(parsed.doc, meta.filePath ?? null, true);
      recoveryId = entry.id;
      lastSnapshotRevision = -1;
      updateTitle();
      fitAfterLoad();
      return true;
    }
    await platform.recoveryDelete(entry.id).catch(() => {});
  }
  return false;
}
