import { describe, expect, it } from "vitest";
import { createPainter } from "../../../../src/ui/theme/resolver.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_RE = new RegExp(`${ESC}\\[\\d+(?:;\\d+)*m`);

describe("createPainter", () => {
  it("emits no ANSI sequences at depth=none", () => {
    const painter = createPainter("none", "dark");
    const out = painter.token("accent", "hello");
    expect(out).toBe("hello");
    expect(out).not.toMatch(ANSI_RE);
    expect(painter.bold("hi")).toBe("hi");
    expect(painter.dim("hi")).toBe("hi");
  });

  it("emits ANSI sequences at depth=truecolor", () => {
    const painter = createPainter("truecolor", "dark");
    const out = painter.token("accent", "hello");
    expect(out).toMatch(ANSI_RE);
    expect(out).toContain("hello");
  });

  it("swaps accent to accentStrong on light theme at truecolor", () => {
    const dark = createPainter("truecolor", "dark").token("accent", "x");
    const light = createPainter("truecolor", "light").token("accent", "x");
    expect(dark).not.toEqual(light);
  });

  it("uses ansi256 codes at depth=ansi256", () => {
    const out = createPainter("ansi256", "dark").token("accent", "x");
    expect(out).toMatch(ANSI_RE);
    expect(out).toContain("38;5;");
  });
});
