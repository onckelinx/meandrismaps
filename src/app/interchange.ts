/** Markdown import/export commands (File → Import Markdown…, File → Export → Markdown…). */
import { documentFromOutline } from "../document/ops";
import { exportMarkdown } from "../export/markdown";
import { importMarkdown } from "../import/markdown";
import { baseName, platform } from "../platform";
import { getState } from "../state/store";
import { notify, showError } from "../ui/dialogs";
import { registerCommands } from "./commands";
import { confirmUnsavedChanges, documentName, loadImported } from "./session";

const MD_FILTER = { name: "Markdown", extensions: ["md", "markdown", "txt"] };

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

export async function importMarkdownFile() {
  if (!(await confirmUnsavedChanges())) return;
  const path = await platform.openDialog([MD_FILTER], "Import Markdown");
  if (!path) return;
  let text: string;
  try {
    text = decodeText(await platform.readFile(path));
  } catch (e) {
    await showError(`“${baseName(path)}” could not be read`, String(e));
    return;
  }
  const title = baseName(path).replace(/\.(md|markdown|txt)$/i, "");
  const result = importMarkdown(text, title);
  loadImported(documentFromOutline(result.root));
  if (result.warnings.length) notify(result.warnings.join(" "), "warning");
}

/** Saves bytes through a save dialog. Returns false if cancelled or failed. */
export async function saveExport(
  bytes: Uint8Array,
  ext: string,
  filter: { name: string; extensions: string[] },
): Promise<boolean> {
  const root = getState().doc.nodes[getState().doc.rootId].text;
  const base = (getState().filePath ? documentName() : root.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").trim()) || "Map";
  let path = await platform.saveDialog(`${base.slice(0, 60)}.${ext}`, [filter], "Export");
  if (!path) return false;
  if (!filter.extensions.some((e) => path!.toLowerCase().endsWith(`.${e}`))) path += `.${ext}`;
  try {
    await platform.writeFile(path, bytes);
    notify(`Exported “${baseName(path)}”.`);
    return true;
  } catch (e) {
    await showError("The export could not be saved", String(e instanceof Error ? e.message : e));
    return false;
  }
}

export async function exportMarkdownFile() {
  const md = exportMarkdown(getState().doc);
  await saveExport(new TextEncoder().encode(md), "md", { name: "Markdown", extensions: ["md", "markdown"] });
}

registerCommands([
  { id: "import.markdown", label: "Import Markdown…", run: importMarkdownFile },
  { id: "export.markdown", label: "Markdown…", run: exportMarkdownFile },
]);
