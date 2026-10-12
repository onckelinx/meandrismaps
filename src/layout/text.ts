/** Word wrapping against an injected width measurer (canvas in the app, a fake in tests). */

export type MeasureWidth = (text: string, font: string) => number;

export function wrapText(text: string, maxWidth: number, font: string, measure: MeasureWidth): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/(\s+)/).filter((w) => w.length > 0);
    let line = "";
    for (const word of words) {
      const candidate = line + word;
      if (line === "" || measure(candidate.trimEnd(), font) <= maxWidth) {
        line = candidate;
        continue;
      }
      out.push(line.trimEnd());
      line = word.trim() === "" ? "" : word;
    }
    // Break single words that are wider than the limit.
    while (line && measure(line.trimEnd(), font) > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut), font) > maxWidth) cut--;
      out.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Canvas-based measurer with a cache. Only usable in the browser. */
export function createCanvasMeasurer(): MeasureWidth {
  const ctx = document.createElement("canvas").getContext("2d")!;
  const cache = new Map<string, number>();
  let lastFont = "";
  return (text, font) => {
    const key = font + "\u0000" + text;
    let w = cache.get(key);
    if (w === undefined) {
      if (lastFont !== font) ctx.font = lastFont = font;
      w = ctx.measureText(text).width;
      if (cache.size > 20000) cache.clear();
      cache.set(key, w);
    }
    return w;
  };
}
