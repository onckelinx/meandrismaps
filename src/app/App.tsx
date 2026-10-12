import { useEffect } from "react";
import { MapCanvas } from "../canvas/MapCanvas";
import { platform } from "../platform";
import { startEditing } from "../state/actions";
import { editorStore, getState } from "../state/store";
import { ContextMenuHost } from "../ui/ContextMenu";
import { DialogHost } from "../ui/dialogs";
import { OutputDialogs } from "../ui/OutputDialogs";
import { SearchBar } from "../ui/SearchBar";
import { ShortcutsPanel } from "../ui/ShortcutsPanel";
import "../images/imageActions";
import { installClipboard } from "./clipboard";
import "./fileCommands";
import "./interchange";
import { installKeyboard } from "./keyboard";
import "./mapCommands";
import { installMenu } from "./menu";
import { handleCloseRequest, offerRecovery, openPath, startAutosave, updateTitle } from "./session";
import "./uiCommands";
import { useMapTheme } from "./useTheme";

let started = false;

/** One-time startup: open a file from the command line, or offer crash recovery, or start typing. */
async function startup() {
  if (started) return;
  started = true;
  platform.onCloseRequested(handleCloseRequest);
  platform.onOpenFiles((paths) => void openPath(paths[0]));
  updateTitle();
  const file = await platform.initialFile().catch(() => null);
  if (file && (await openPath(file, { skipConfirm: true }))) return;
  if (await offerRecovery()) return;
  startEditing(getState().doc.rootId);
}

export default function App() {
  const theme = useMapTheme();

  useEffect(() => installKeyboard(), []);
  useEffect(() => installClipboard(), []);
  useEffect(() => installMenu(), []);
  useEffect(() => startAutosave(), []);
  useEffect(() => {
    let last = { past: getState().past, saved: getState().savedEntry, path: getState().filePath };
    return editorStore.subscribe((s) => {
      if (s.past !== last.past || s.savedEntry !== last.saved || s.filePath !== last.path) {
        last = { past: s.past, saved: s.savedEntry, path: s.filePath };
        updateTitle();
      }
    });
  }, []);
  useEffect(() => void startup(), []);

  return (
    <div className="app">
      <MapCanvas theme={theme} />
      <SearchBar />
      <ContextMenuHost />
      <ShortcutsPanel />
      <OutputDialogs />
      <DialogHost />
    </div>
  );
}
