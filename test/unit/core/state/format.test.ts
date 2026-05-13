import { describe, expect, it } from "vitest";
import { handlerFor, isSupportedFormat } from "../../../../src/core/state/format.js";

describe("format dispatch", () => {
  for (const ext of [".md", ".markdown", ".html", ".htm", ".yaml", ".yml", ".json", ".txt"]) {
    it(`recognizes ${ext} as supported`, () => {
      expect(isSupportedFormat(`some/file${ext}`)).toBe(true);
      expect(handlerFor(`some/file${ext}`)).toBeDefined();
    });
  }

  for (const ext of ["", ".png", ".pdf", ".js", ".ts", ".bin"]) {
    it(`treats ${ext || "(no extension)"} as unsupported`, () => {
      expect(isSupportedFormat(`some/file${ext}`)).toBe(false);
      expect(handlerFor(`some/file${ext}`)).toBeUndefined();
    });
  }

  it("is case-insensitive on the extension", () => {
    expect(isSupportedFormat("README.MD")).toBe(true);
    expect(isSupportedFormat("page.HTML")).toBe(true);
  });
});
