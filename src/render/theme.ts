/** Colours used to draw the map itself (not the app chrome). */
export interface MapTheme {
  name: "light" | "dark";
  background: string;
  text: string;
  mutedText: string;
  rootFill: string;
  rootStroke: string;
  rootText: string;
  badgeFill: string;
  selection: string;
  boundaryFillOpacity: number;
  boundaryStrokeOpacity: number;
}

export const LIGHT_THEME: MapTheme = {
  name: "light",
  background: "#fbfaf7",
  text: "#23262b",
  mutedText: "#8a8f98",
  rootFill: "#ffffff",
  rootStroke: "#5f7183",
  rootText: "#1c1f24",
  badgeFill: "#ffffff",
  selection: "#2f6fe0",
  boundaryFillOpacity: 0.09,
  boundaryStrokeOpacity: 0.55,
};

export const DARK_THEME: MapTheme = {
  name: "dark",
  background: "#1b1d21",
  text: "#e6e7ea",
  mutedText: "#8d929b",
  rootFill: "#272a30",
  rootStroke: "#8193a6",
  rootText: "#f2f3f5",
  badgeFill: "#1b1d21",
  selection: "#6aa0ff",
  boundaryFillOpacity: 0.14,
  boundaryStrokeOpacity: 0.6,
};
