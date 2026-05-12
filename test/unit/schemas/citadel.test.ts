import { describe, expect, it } from "vitest";
import { CitadelConfigSchema, MaesterSourceSchema } from "../../../src/schemas/citadel.js";

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

describe("CitadelConfigSchema", () => {
  it("accepts a minimal valid citadel config", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty sources", () => {
    const result = CitadelConfigSchema.safeParse({ schemaVersion: 1, sources: [] });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate source names", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: [
        { name: "dup", url: "https://example.com/a.git" },
        { name: "dup", url: "https://example.com/b.git" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/duplicate/);
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
});
