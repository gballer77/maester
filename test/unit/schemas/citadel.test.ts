import { describe, expect, it } from "vitest";
import {
  CitadelConfigSchema,
  CitadelConfigV1Schema,
  MaesterSourceSchema,
  RavenSourceSchema,
  migrateCitadelV1ToV2,
} from "../../../src/schemas/citadel.js";

describe("MaesterSourceSchema", () => {
  it("accepts a minimal valid source with delegated auth", () => {
    const result = MaesterSourceSchema.safeParse({
      name: "design-system",
      url: "https://github.com/example-org/design-system.git",
    });
    expect(result.success).toBe(true);
  });

  it("accepts SSH URLs", () => {
    const result = MaesterSourceSchema.safeParse({
      name: "design-system",
      url: "git@github.com:example/repo.git",
    });
    expect(result.success).toBe(true);
  });

  it("rejects names with uppercase letters", () => {
    const result = MaesterSourceSchema.safeParse({ name: "DesignSystem", url: "https://x.git" });
    expect(result.success).toBe(false);
  });

  it("rejects URLs with whitespace", () => {
    const result = MaesterSourceSchema.safeParse({ name: "x", url: "https:// example.com" });
    expect(result.success).toBe(false);
  });

  it("rejects destinations containing '..'", () => {
    const result = MaesterSourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      destination: "../escape",
    });
    expect(result.success).toBe(false);
  });

  it("rejects destinations with leading slash", () => {
    const result = MaesterSourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      destination: "/abs/path",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a token auth ref with valid envVar", () => {
    const result = MaesterSourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      auth: { type: "token", envVar: "MAESTER_TOKEN" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a token auth ref without envVar", () => {
    const result = MaesterSourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      auth: { type: "token" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an envVar with lowercase letters", () => {
    const result = MaesterSourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      auth: { type: "token", envVar: "mixed_Case" },
    });
    expect(result.success).toBe(false);
  });
});

describe("RavenSourceSchema", () => {
  it("accepts a minimal valid raven with includes and delegated auth", () => {
    const result = RavenSourceSchema.safeParse({
      name: "react-docs",
      url: "https://github.com/facebook/react.git",
      includes: ["docs/**/*.md", "README.md"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a raven with an empty includes array", () => {
    const result = RavenSourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      includes: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an includes entry containing '..'", () => {
    const result = RavenSourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      includes: ["../escape"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an includes entry with a leading slash", () => {
    const result = RavenSourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      includes: ["/abs/path"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional description and tags", () => {
    const result = RavenSourceSchema.safeParse({
      name: "vendor-api",
      url: "https://example.com/r.git",
      includes: ["openapi/**/*.yaml"],
      description: "Upstream API spec",
      tags: ["api", "upstream"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-slug tags", () => {
    const result = RavenSourceSchema.safeParse({
      name: "x",
      url: "https://example.com/r.git",
      includes: ["docs/**"],
      tags: ["NotASlug"],
    });
    expect(result.success).toBe(false);
  });
});

describe("CitadelConfigSchema (v2)", () => {
  it("accepts a citadel with only maesters", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      maesters: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a citadel with only ravens", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      ravens: [{ name: "vendor", url: "https://example.com/v.git", includes: ["docs/**"] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a citadel with both maesters and ravens", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      maesters: [{ name: "alpha", url: "https://example.com/a.git" }],
      ravens: [{ name: "beta", url: "https://example.com/b.git", includes: ["README.md"] }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty citadel (no maesters and no ravens)", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      maesters: [],
      ravens: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/at least one/i);
    }
  });

  it("rejects when a maester and a raven share the same name", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      maesters: [{ name: "shared", url: "https://example.com/a.git" }],
      ravens: [{ name: "shared", url: "https://example.com/b.git", includes: ["README.md"] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/duplicate name/i);
    }
  });

  it("rejects when a maester and a raven resolve to the same destination", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      maesters: [{ name: "alpha", url: "https://example.com/a.git", destination: "shared" }],
      ravens: [
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

  it("rejects duplicate maester names", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      maesters: [
        { name: "dup", url: "https://example.com/a.git" },
        { name: "dup", url: "https://example.com/b.git" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      maesters: [{ name: "x", url: "https://example.com/r.git" }],
      extra: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("rejects schemaVersion != 2", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 3,
      maesters: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(false);
  });

  it("defaults ravens to an empty array when omitted", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 2,
      maesters: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ravens).toEqual([]);
    }
  });
});

describe("CitadelConfigV1Schema + migration", () => {
  it("accepts a v1 citadel with sources", () => {
    const result = CitadelConfigV1Schema.safeParse({
      schemaVersion: 1,
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty v1 citadel via the combined invariants", () => {
    const result = CitadelConfigV1Schema.safeParse({
      schemaVersion: 1,
      sources: [],
    });
    expect(result.success).toBe(false);
  });

  it("migrates v1 to v2 by mapping sources -> maesters with ravens = []", () => {
    const v1 = CitadelConfigV1Schema.parse({
      schemaVersion: 1,
      sources: [
        { name: "alpha", url: "https://example.com/a.git" },
        { name: "beta", url: "https://example.com/b.git", ref: "main" },
      ],
    });
    const v2 = migrateCitadelV1ToV2(v1);
    expect(v2.schemaVersion).toBe(2);
    expect(v2.maesters).toHaveLength(2);
    expect(v2.ravens).toEqual([]);
  });

  it("rejects v1 duplicate source names via the combined invariants", () => {
    const result = CitadelConfigV1Schema.safeParse({
      schemaVersion: 1,
      sources: [
        { name: "dup", url: "https://example.com/a.git" },
        { name: "dup", url: "https://example.com/b.git" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/duplicate/i);
    }
  });
});
