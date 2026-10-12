import { describe, expect, it } from "vitest";
import { arrowExit, caretLine } from "./editorKeys";

const one = (text: string) => [text];

describe("arrowExit", () => {
  it("← leaves only at the start, → only at the end", () => {
    expect(arrowExit("ArrowLeft", "rik", 0, 0, one("rik"))).toBe("left");
    expect(arrowExit("ArrowLeft", "rik", 2, 2, one("rik"))).toBeNull();
    expect(arrowExit("ArrowRight", "rik", 3, 3, one("rik"))).toBe("right");
    expect(arrowExit("ArrowRight", "rik", 1, 1, one("rik"))).toBeNull();
  });

  it("↑/↓ always leave a single-line topic", () => {
    expect(arrowExit("ArrowUp", "rik", 1, 1, one("rik"))).toBe("up");
    expect(arrowExit("ArrowDown", "rik", 1, 1, one("rik"))).toBe("down");
  });

  it("every arrow leaves an empty topic", () => {
    for (const [key, dir] of [
      ["ArrowUp", "up"],
      ["ArrowDown", "down"],
      ["ArrowLeft", "left"],
      ["ArrowRight", "right"],
    ]) {
      expect(arrowExit(key, "", 0, 0, [""])).toBe(dir);
    }
  });

  it("↑/↓ only leave from the first/last wrapped line", () => {
    const text = "one two three four";
    const lines = ["one two", "three", "four"];
    expect(arrowExit("ArrowUp", text, 3, 3, lines)).toBe("up");
    expect(arrowExit("ArrowDown", text, 3, 3, lines)).toBeNull();
    expect(arrowExit("ArrowUp", text, 10, 10, lines)).toBeNull(); // "three"
    expect(arrowExit("ArrowDown", text, 10, 10, lines)).toBeNull();
    expect(arrowExit("ArrowDown", text, text.length, text.length, lines)).toBe("down");
    expect(arrowExit("ArrowUp", text, text.length, text.length, lines)).toBeNull();
  });

  it("handles explicit line breaks", () => {
    const text = "first\nsecond";
    const lines = ["first", "second"];
    expect(caretLine(text, lines, 5)).toBe(0);
    expect(caretLine(text, lines, 6)).toBe(1);
    expect(arrowExit("ArrowUp", text, 8, 8, lines)).toBeNull();
    expect(arrowExit("ArrowDown", text, 2, 2, lines)).toBeNull();
  });

  it("does nothing with a text selection or other keys", () => {
    expect(arrowExit("ArrowLeft", "rik", 0, 3, one("rik"))).toBeNull();
    expect(arrowExit("ArrowUp", "rik", 0, 2, one("rik"))).toBeNull();
    expect(arrowExit("Enter", "rik", 3, 3, one("rik"))).toBeNull();
  });
});
