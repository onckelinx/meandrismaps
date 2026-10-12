import { browserPlatform } from "./browser";
import { tauriPlatform } from "./tauri";
import type { Platform } from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const platform: Platform = isTauri ? tauriPlatform : browserPlatform;

export * from "./types";
