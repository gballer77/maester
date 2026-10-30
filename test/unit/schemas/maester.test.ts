import { describe, expect, it } from "vitest";
import { MaesterConfigSchema, PublishedDocumentSchema } from "../../../src/schemas/maester.js";

describe("PublishedDocumentSchema", () => {
  it("accepts a minimal entry with just a path", () => {
    expect(PublishedDocumentSchema.safeParse({ path: "README.md" }).success).toBe(true);
  });

  it("accepts a glob path", () => {
    expect(PublishedDocumentSchema.safeParse({ path: "docs/adr/*.md" }).success).toBe(true);
  });

  it("rejects leading slash paths", () => {
    expect(PublishedDocumentSchema.safeParse({ path: "/README.md" }).success).toBe(false);
  });

  it("rejects path with '..'", () => {
    expect(PublishedDocumentSchema.safeParse({ path: "../README.md" }).success).toBe(false);
  });

  it("accepts optional description, category, tags", () => {
    const result = PublishedDocumentSchema.safeParse({
      path: "docs/api/reference.md",
      description: "API ref",
      category: "api",
      tags: ["public-api"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-slug category or tag with a field-named error", () => {
    const result = PublishedDocumentSchema.safeParse({
      path: "docs/**",
      category: "API Docs",
      tags: ["public", "Internal"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toEqual(["category", "tags.1"]);
      expect(result.error.issues[0]?.message).toMatch(
        /category must be a lowercase kebab-case slug/,
      );
    }
  });

  it("accepts an entry with state=canon", () => {
    const result = PublishedDocumentSchema.safeParse({ path: "README.md", state: "canon" });
    expect(result.success).toBe(true);
  });

  it("accepts an entry with state=draft", () => {
    const result = PublishedDocumentSchema.safeParse({ path: "docs/wip.md", state: "draft" });
    expect(result.success).toBe(true);
  });

  it("treats state as optional", () => {
    const result = PublishedDocumentSchema.safeParse({ path: "README.md" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.state).toBeUndefined();
  });

  it("rejects unknown state values", () => {
    const result = PublishedDocumentSchema.safeParse({ path: "README.md", state: "published" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(PublishedDocumentSchema.safeParse({ path: "README.md", extra: 1 }).success).toBe(false);
  });
});

describe("MaesterConfigSchema", () => {
  it("accepts a minimal valid maester config", () => {
    expect(
      MaesterConfigSchema.safeParse({
        schemaVersion: 1,
        documents: [{ path: "README.md" }],
      }).success,
    ).toBe(true);
  });

  it("accepts an empty manifest (publishes the whole repository)", () => {
    const result = MaesterConfigSchema.safeParse({ schemaVersion: 1, documents: [] });
    expect(result.success).toBe(true);
  });

  it("defaults an omitted documents list to empty", () => {
    const result = MaesterConfigSchema.safeParse({ schemaVersion: 1 });
    expect(result.success && result.data.documents).toEqual([]);
  });

  it("rejects duplicate document paths", () => {
    const result = MaesterConfigSchema.safeParse({
      schemaVersion: 1,
      documents: [{ path: "README.md" }, { path: "README.md" }],
    });
    expect(result.success).toBe(false);
  });
});
