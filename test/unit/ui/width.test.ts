import { describe, expect, it } from "vitest";
import { classifyWidth, effectivePanelWidth, effectiveProseWidth } from "../../../src/ui/width.js";

describe("classifyWidth", () => {
  it("returns 'tiny' below 40 cells", () => {
    expect(classifyWidth(39)).toBe("tiny");
    expect(classifyWidth(0)).toBe("tiny");
  });

  it("returns 'compact' between 40 and 79", () => {
    expect(classifyWidth(40)).toBe("compact");
    expect(classifyWidth(79)).toBe("compact");
  });

  it("returns 'default' at 80 cells or more", () => {
    expect(classifyWidth(80)).toBe("default");
    expect(classifyWidth(200)).toBe("default");
  });
});

describe("effectivePanelWidth", () => {
  it("caps panel width at 100", () => {
    expect(effectivePanelWidth(200)).toBe(100);
    expect(effectivePanelWidth(72)).toBe(72);
  });
});

describe("effectiveProseWidth", () => {
  it("caps prose width at 80", () => {
    expect(effectiveProseWidth(200)).toBe(80);
    expect(effectiveProseWidth(72)).toBe(72);
  });
});
