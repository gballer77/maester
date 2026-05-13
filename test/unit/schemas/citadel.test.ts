import { describe, expect, it } from "vitest";
import { CitadelConfigSchema, SourceSchema } from "../../../src/schemas/citadel.js";

describe("SourceSchema", () => {
  it("accepts a minimal valid source", () => {
    const result = SourceSchema.safeParse({
      name: "design-system",
      url: "https://github.com/example-org/design-system.git",
    });
    expect(result.success).toBe(true);
  });

  it("accepts SSH URLs", () => {
    const result = SourceSchema.safeParse({
      name: "design-system",
      url: "git@github.com:example/repo.git",
    });
    expect(result.success).toBe(true);
  });

  it("rejects names with uppercase letters", () => {
    const result = SourceSchema.safeParse({ name: "DesignSystem", url: "https://x.git" });
    expect(result.success).toBe(false);
  });

  it("rejects URLs with whitespace", () => {
    const result = SourceSchema.safeParse({ name: "x", url: "https:// example.com" });
    expect(result.success).toBe(false);
  });

  it("rejects destinations containing '..'", () => {
    const result = SourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      destination: "../escape",
    });
    expect(result.success).toBe(false);
  });

  it("rejects destinations with leading slash", () => {
    const result = SourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      destination: "/abs/path",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a token auth ref with valid envVar", () => {
    const result = SourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      auth: { type: "token", envVar: "MAESTER_TOKEN" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a token auth ref without envVar", () => {
    const result = SourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      auth: { type: "token" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an envVar with lowercase letters", () => {
    const result = SourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      auth: { type: "token", envVar: "mixed_Case" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit includes list", () => {
    const result = SourceSchema.safeParse({
      name: "react-docs",
      url: "https://github.com/facebook/react.git",
      includes: ["docs/**/*.md", "README.md"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty includes array (when present)", () => {
    const result = SourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      includes: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an includes entry containing '..'", () => {
    const result = SourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      includes: ["../escape"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an includes entry with a leading slash", () => {
    const result = SourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      includes: ["/abs/path"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional description and tags", () => {
    const result = SourceSchema.safeParse({
      name: "vendor-api",
      url: "https://example.com/r.git",
      includes: ["openapi/**/*.yaml"],
      description: "Upstream API spec",
      tags: ["api", "upstream"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-slug tags", () => {
    const result = SourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      tags: ["NotASlug"],
    });
    expect(result.success).toBe(false);
  });
});

describe("CitadelConfigSchema", () => {
  it("accepts a citadel with manifest-driven sources", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a citadel with includes-driven sources", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: [{ name: "vendor", url: "https://example.com/v.git", includes: ["docs/**"] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a citadel with a mix of manifest-driven and includes-driven sources", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: [
        { name: "alpha", url: "https://example.com/a.git" },
        { name: "beta", url: "https://example.com/b.git", includes: ["README.md"] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty citadel (no sources)", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/at least one/i);
    }
  });

  it("rejects duplicate source names", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: [
        { name: "shared", url: "https://example.com/a.git" },
        { name: "shared", url: "https://example.com/b.git", includes: ["README.md"] },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/duplicate name/i);
    }
  });

  it("rejects two sources that resolve to the same destination", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: [
        { name: "alpha", url: "https://example.com/a.git", destination: "shared" },
        {
          name: "beta",
          url: "https://example.com/b.git",
          includes: ["README.md"],
          destination: "shared",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/destination collision/i);
    }
  });

  it("rejects unknown top-level fields (strict)", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: [{ name: "x", url: "https://example.com/r.git" }],
      extra: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("rejects schemaVersion != 1", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(false);
  });

  it("defaults sources to an empty array when omitted (then fails the at-least-one check)", () => {
    const result = CitadelConfigSchema.safeParse({ schemaVersion: 1 });
    expect(result.success).toBe(false);
  });

  it("accepts an optional baseDir", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      baseDir: "vendor",
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseDir).toBe("vendor");
    }
  });

  it("rejects a baseDir with a leading slash", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      baseDir: "/abs",
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a baseDir containing '..'", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      baseDir: "vendor/../escape",
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(false);
  });

  it("uses baseDir when resolving collisions between defaulted destinations", () => {
    const okResult = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      baseDir: "vendor",
      sources: [
        { name: "alpha", url: "https://example.com/a.git" },
        { name: "beta", url: "https://example.com/b.git" },
      ],
    });
    expect(okResult.success).toBe(true);

    const conflict = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      baseDir: "vendor",
      sources: [
        { name: "alpha", url: "https://example.com/a.git" },
        { name: "other", url: "https://example.com/b.git", destination: "vendor/alpha" },
      ],
    });
    expect(conflict.success).toBe(false);
    if (!conflict.success) {
      expect(conflict.error.issues[0]?.message).toMatch(/destination collision/i);
    }
  });

  it("does not flag a collision against `citadel/<name>/` when baseDir is set elsewhere", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      baseDir: "vendor",
      sources: [
        { name: "alpha", url: "https://example.com/a.git" },
        { name: "other", url: "https://example.com/b.git", destination: "citadel/alpha" },
      ],
    });
    expect(result.success).toBe(true);
  });
});
