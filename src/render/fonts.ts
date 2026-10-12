/**
 * The bundled map font (Inter, SIL OFL). Bundling it makes text metrics, and
 * therefore layouts, identical on macOS, Linux and Windows, and lets exports embed it.
 */
import latin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import latinExt from "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url";
import greek from "@fontsource-variable/inter/files/inter-greek-wght-normal.woff2?url";
import cyrillic from "@fontsource-variable/inter/files/inter-cyrillic-wght-normal.woff2?url";

interface FontFile {
  url: string;
  range: string;
  /** Regex matching characters this subset covers (used to decide what to embed). */
  test: RegExp;
}

export const FONT_FILES: FontFile[] = [
  {
    url: latin,
    range:
      "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    test: /[\u0000-ÿ]/,
  },
  {
    url: latinExt,
    range:
      "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    test: /[Ā-˿ᴀ-ỿⱠ-Ɀ꜠-ꟿ]/,
  },
  {
    url: greek,
    range: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF",
    test: /[Ͱ-Ͽ]/,
  },
  {
    url: cyrillic,
    range: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116",
    test: /[Ѐ-џҐ-ұ]/,
  },
];

function fontFace(src: string, range: string): string {
  return (
    `@font-face{font-family:"Inter Variable";font-style:normal;font-display:block;` +
    `font-weight:100 900;src:url("${src}") format("woff2");unicode-range:${range};}`
  );
}

/** Registers the font for the app and waits until the weights in use are ready. */
export async function installFonts(): Promise<void> {
  const style = document.createElement("style");
  style.textContent = FONT_FILES.map((f) => fontFace(f.url, f.range)).join("\n");
  document.head.appendChild(style);
  try {
    await Promise.all(
      [450, 500, 600, 650].map((w) => document.fonts.load(`${w} 16px "Inter Variable"`, "Aa")),
    );
  } catch {
    // Fall back to system fonts; layout still works, just with different metrics.
  }
}

const dataUrlCache = new Map<string, string>();

async function toDataUrl(url: string): Promise<string> {
  const cached = dataUrlCache.get(url);
  if (cached) return cached;
  const blob = await (await fetch(url)).blob();
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]*/, "data:font/woff2"));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  dataUrlCache.set(url, data);
  return data;
}

/** @font-face rules with embedded data for the subsets needed by `text`. */
export async function embeddedFontCss(text: string): Promise<string> {
  const needed = FONT_FILES.filter((f, i) => i === 0 || f.test.test(text));
  const faces = await Promise.all(needed.map(async (f) => fontFace(await toDataUrl(f.url), f.range)));
  return faces.join("\n");
}
