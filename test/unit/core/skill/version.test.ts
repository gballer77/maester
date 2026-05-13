import { describe, expect, it } from "vitest";
import { SKILL_VERSION } from "../../../../src/core/skill/version.js";
import { PACKAGE_VERSION } from "../../../../src/package-meta.js";

describe("SKILL_VERSION", () => {
  it("matches the package.json version", () => {
    expect(SKILL_VERSION).toBe(PACKAGE_VERSION);
    expect(SKILL_VERSION.length).toBeGreaterThan(0);
  });
});
