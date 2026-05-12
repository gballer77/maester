import { describe, expect, it } from "vitest";
import { renderBox } from "../../../src/ui/components/box.js";
import { createTheming } from "../../../src/ui/theme/index.js";

describe("renderBox", () => {
  it("wraps content with a light border on a TTY", () => {
    const theming = createTheming({
      env: { COLORTERM: "truecolor" },
      isTTY: true,
      unicodeOverride: true,
    });
    const out = renderBox(theming, "hello", { title: "Summary", style: "light" });
    expect(out).toContain("hello");
    expect(out).toContain("Summary");
    expect(out).toMatch(/[─│┌┐└┘╭╮╰╯]/);
  });

  it("falls back to a delimited plain block when non-TTY", () => {
    const theming = createTheming({
      env: { NO_COLOR: "1" },
      isTTY: false,
      unicodeOverride: true,
    });
    const out = renderBox(theming, "hello", { title: "Summary" });
    expect(out).toContain("hello");
    expect(out).toContain("Summary");
    expect(out).toContain("---");
  });
});
