/**
 * The constrained branch-colour palette. Mid-saturation colours that read on
 * both light and dark canvases and on paper.
 */
export interface PaletteColor {
  name: string;
  value: string;
}

export const PALETTE: PaletteColor[] = [
  { name: "Blue", value: "#3d7fd9" },
  { name: "Red", value: "#d9534a" },
  { name: "Green", value: "#3fa66a" },
  { name: "Orange", value: "#e08a2e" },
  { name: "Purple", value: "#8a5cc9" },
  { name: "Teal", value: "#2a9da6" },
  { name: "Pink", value: "#cf5a9a" },
  { name: "Olive", value: "#8f9a2c" },
  { name: "Brown", value: "#9a6b47" },
  { name: "Slate", value: "#5f7183" },
];

export const ROOT_COLOR = "#5f7183";
