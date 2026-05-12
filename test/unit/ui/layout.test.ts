import { describe, expect, it } from "vitest";
import { indent, keyValue, stack, wrap } from "../../../src/ui/layout.js";

describe("stack", () => {
  it("joins lines with a blank line between them by default", () => {
    expect(stack(["a", "b", "c"])).toBe("a\n\nb\n\nc");
  });

  it("filters empty lines", () => {
    expect(stack(["a", "", "b"])).toBe("a\n\nb");
  });

  it("supports gap=0 for tight stacking", () => {
    expect(stack(["a", "b"], 0)).toBe("a\nb");
  });
});

describe("keyValue", () => {
  it("aligns values to the widest key", () => {
    const out = keyValue([
      { key: "short", value: "1" },
      { key: "longerkey", value: "2" },
    ]);
    const lines = out.split("\n");
    expect(lines[0]).toBe("short      1");
    expect(lines[1]).toBe("longerkey  2");
  });

  it("returns empty string on empty input", () => {
    expect(keyValue([])).toBe("");
  });
});

describe("indent", () => {
  it("indents every line including wrapped ones", () => {
    const out = indent("a\nb\nc", 2);
    expect(out).toBe("  a\n  b\n  c");
  });

  it("leaves blank lines empty", () => {
    expect(indent("a\n\nb", 2)).toBe("  a\n\n  b");
  });
});

describe("wrap", () => {
  it("wraps text at the given width on word boundaries", () => {
    const out = wrap("the quick brown fox jumps over the lazy dog", 20);
    const lines = out.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  it("never breaks a word mid-character", () => {
    const out = wrap("supercalifragilisticexpialidocious word", 10);
    expect(out.split("\n")[0]).toBe("supercalifragilisticexpialidocious");
  });
});
