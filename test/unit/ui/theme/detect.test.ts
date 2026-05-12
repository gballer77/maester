import { describe, expect, it } from "vitest";
import {
  detect,
  detectColorDepth,
  detectTheme,
  detectUnicode,
} from "../../../../src/ui/theme/detect.js";

describe("detectColorDepth", () => {
  it("returns 'none' when NO_COLOR is set", () => {
    expect(detectColorDepth({ NO_COLOR: "1" }, true)).toBe("none");
  });

  it("returns 'none' when stdout is not a TTY", () => {
    expect(detectColorDepth({}, false)).toBe("none");
  });

  it("returns 'truecolor' when COLORTERM=truecolor", () => {
    expect(detectColorDepth({ COLORTERM: "truecolor" }, true)).toBe("truecolor");
  });

  it("returns 'ansi256' when TERM mentions 256color", () => {
    expect(detectColorDepth({ TERM: "xterm-256color" }, true)).toBe("ansi256");
  });

  it("honors FORCE_COLOR=3 even when not a TTY", () => {
    expect(detectColorDepth({ FORCE_COLOR: "3" }, false)).toBe("truecolor");
  });

  it("returns 'none' when FORCE_COLOR=0", () => {
    expect(detectColorDepth({ FORCE_COLOR: "0", COLORTERM: "truecolor" }, true)).toBe("none");
  });
});

describe("detectTheme", () => {
  it("defaults to dark with no signals", () => {
    expect(detectTheme({})).toBe("dark");
  });

  it("honors MAESTER_THEME=light", () => {
    expect(detectTheme({ MAESTER_THEME: "light" })).toBe("light");
  });

  it("infers light from COLORFGBG when background is bright", () => {
    expect(detectTheme({ COLORFGBG: "0;15" })).toBe("light");
  });

  it("infers dark from COLORFGBG when background is 0", () => {
    expect(detectTheme({ COLORFGBG: "15;0" })).toBe("dark");
  });

  it("honors override argument over env", () => {
    expect(detectTheme({ MAESTER_THEME: "light" }, "dark")).toBe("dark");
  });
});

describe("detectUnicode", () => {
  it("returns true when LANG mentions UTF-8", () => {
    expect(detectUnicode({ LANG: "en_US.UTF-8" })).toBe(true);
  });

  it("honors override", () => {
    expect(detectUnicode({ LANG: "C" }, false)).toBe(false);
  });
});

describe("detect", () => {
  it("composes capabilities from env", () => {
    const caps = detect({
      env: { COLORTERM: "truecolor", LANG: "en_US.UTF-8", MAESTER_THEME: "light" },
      isTTY: true,
    });
    expect(caps.colorDepth).toBe("truecolor");
    expect(caps.theme).toBe("light");
    expect(caps.unicode).toBe(true);
    expect(caps.isTTY).toBe(true);
  });
});
