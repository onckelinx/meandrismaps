import { useEffect, useState } from "react";
import { createStore, useStore } from "zustand";
import { DARK_THEME, LIGHT_THEME, type MapTheme } from "../render/theme";

export type ThemePreference = "system" | "light" | "dark";

function loadPreference(): ThemePreference {
  try {
    const v = localStorage.getItem("meandrismaps.theme");
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // storage unavailable
  }
  return "system";
}

export const themeStore = createStore<{ preference: ThemePreference }>(() => ({ preference: loadPreference() }));

export function setThemePreference(preference: ThemePreference) {
  themeStore.setState({ preference });
  try {
    localStorage.setItem("meandrismaps.theme", preference);
  } catch {
    // storage unavailable
  }
}

/** The effective map theme, following the system unless overridden. */
export function useMapTheme(): MapTheme {
  const preference = useStore(themeStore, (s) => s.preference);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dark = preference === "dark" || (preference === "system" && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return dark ? DARK_THEME : LIGHT_THEME;
}
