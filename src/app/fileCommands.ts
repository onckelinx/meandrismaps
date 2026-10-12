/** File, window and app-level commands. */
import type { LayoutMode } from "../document/model";
import { setLayoutMode } from "../document/ops";
import { platform } from "../platform";
import { apply } from "../state/store";
import { registerCommands } from "./commands";
import { newMap, openMap, saveMap, saveMapAs } from "./session";
import { setThemePreference } from "./useTheme";

function changeLayout(mode: LayoutMode) {
  apply(mode === "right" ? "Branches to the Right" : "Branches on Both Sides", (d) => setLayoutMode(d, mode));
}

registerCommands([
  { id: "file.new", label: "New", keys: ["Mod+N"], global: true, run: newMap },
  { id: "file.open", label: "Open…", keys: ["Mod+O"], global: true, run: openMap },
  { id: "file.save", label: "Save", keys: ["Mod+S"], global: true, run: () => void saveMap() },
  { id: "file.saveAs", label: "Save As…", keys: ["Mod+Shift+S"], global: true, run: () => void saveMapAs() },
  { id: "file.close", label: "Close Window", keys: ["Mod+W"], global: true, run: () => platform.closeWindow() },
  { id: "app.quit", label: "Quit", keys: ["Mod+Q"], global: true, run: () => platform.closeWindow() },
  { id: "view.layoutBoth", label: "Branches on Both Sides", run: () => changeLayout("both") },
  { id: "view.layoutRight", label: "Branches to the Right", run: () => changeLayout("right") },
  { id: "view.themeSystem", label: "Use System Setting", run: () => setThemePreference("system") },
  { id: "view.themeLight", label: "Light", run: () => setThemePreference("light") },
  { id: "view.themeDark", label: "Dark", run: () => setThemePreference("dark") },
]);
