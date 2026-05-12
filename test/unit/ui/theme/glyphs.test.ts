import { describe, expect, it } from "vitest";
import { glyph, spinnerFrames } from "../../../../src/ui/theme/glyphs.js";

describe("glyph", () => {
  it("returns Unicode glyph + token when unicode is enabled", () => {
    const g = glyph("success", true);
    expect(g.text).toBe("✓");
    expect(g.token).toBe("success");
  });

  it("falls back to ASCII when unicode disabled", () => {
    const g = glyph("success", false);
    expect(g.text).toBe("[ok]");
  });

  it("provides every documented role", () => {
    const roles = [
      "cursor",
      "checkOff",
      "checkOn",
      "success",
      "warning",
      "error",
      "info",
      "bullet",
    ] as const;
    for (const role of roles) {
      expect(glyph(role, true).text).toBeTruthy();
      expect(glyph(role, false).text).toBeTruthy();
    }
  });
});

describe("spinnerFrames", () => {
  it("returns 10 braille frames in unicode mode", () => {
    const frames = spinnerFrames(true);
    expect(frames).toHaveLength(10);
    expect(frames[0]).toBe("⠋");
  });

  it("returns ASCII frames in fallback mode", () => {
    expect(spinnerFrames(false).length).toBeGreaterThan(0);
    expect(spinnerFrames(false)[0]).toBe("|");
  });
});
