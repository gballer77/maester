import { describe, expect, it } from "vitest";
import {
  bannerForContext,
  renderBanner,
  selectBannerVariant,
} from "../../../src/ui/components/banner.js";
import { createTheming } from "../../../src/ui/theme/index.js";

describe("selectBannerVariant", () => {
  it("returns 'suppressed' when not on a TTY", () => {
    expect(selectBannerVariant(120, false)).toBe("suppressed");
  });

  it("returns 'suppressed' below 40 cells", () => {
    expect(selectBannerVariant(30, true)).toBe("suppressed");
  });

  it("returns 'compact' between 40 and 79 cells", () => {
    expect(selectBannerVariant(40, true)).toBe("compact");
    expect(selectBannerVariant(79, true)).toBe("compact");
  });

  it("returns 'full' at 80 cells or more", () => {
    expect(selectBannerVariant(80, true)).toBe("full");
    expect(selectBannerVariant(200, true)).toBe("full");
  });
});

describe("renderBanner", () => {
  it("returns an empty string when variant is suppressed", () => {
    const theming = createTheming({ env: { COLORTERM: "truecolor" }, isTTY: true });
    expect(renderBanner(theming, "suppressed")).toBe("");
  });

  it("renders the full ASCII art with a subtitle when sized", () => {
    const theming = createTheming({ env: { NO_COLOR: "1" }, isTTY: true });
    const out = renderBanner(theming, "full", { subtitle: "v0.1.0" });
    expect(out).toContain("__");
    expect(out).toContain("v0.1.0");
  });

  it("emits no ANSI escapes under NO_COLOR", () => {
    const theming = createTheming({ env: { NO_COLOR: "1" }, isTTY: true });
    const out = renderBanner(theming, "full", { subtitle: "x" });
    const ESC = String.fromCharCode(0x1b);
    expect(out).not.toContain(ESC);
  });
});

describe("bannerForContext", () => {
  it("returns an empty string when stdout is not a TTY", () => {
    const theming = createTheming({ env: { NO_COLOR: "1" }, isTTY: false });
    expect(bannerForContext(theming, 200)).toBe("");
  });
});
