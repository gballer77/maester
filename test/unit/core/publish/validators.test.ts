import { describe, expect, it } from "vitest";
import {
  isGlobPath,
  parseTags,
  validateCategory,
  validateDocumentPath,
  validateTags,
} from "../../../../src/core/publish/validators.js";

describe("validateDocumentPath", () => {
  it("accepts a simple file path", () => {
    expect(validateDocumentPath("README.md").ok).toBe(true);
  });

  it("accepts nested paths and globs", () => {
    expect(validateDocumentPath("docs/runbooks/**/*.md").ok).toBe(true);
  });

  it("rejects empty input", () => {
    expect(validateDocumentPath("").ok).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    expect(validateDocumentPath("   ").ok).toBe(false);
  });

  it("rejects leading slash", () => {
    expect(validateDocumentPath("/abs/path.md").ok).toBe(false);
  });

  it("rejects '..' segments", () => {
    expect(validateDocumentPath("../escape.md").ok).toBe(false);
  });
});

describe("isGlobPath", () => {
  it("detects globs containing *", () => {
    expect(isGlobPath("docs/*.md")).toBe(true);
  });

  it("detects globs containing ?", () => {
    expect(isGlobPath("docs/file?.md")).toBe(true);
  });

  it("returns false for plain paths", () => {
    expect(isGlobPath("README.md")).toBe(false);
  });
});

describe("validateCategory", () => {
  it("accepts a blank value (means no category)", () => {
    expect(validateCategory("").ok).toBe(true);
  });

  it("accepts a kebab-case slug", () => {
    expect(validateCategory("runbook").ok).toBe(true);
  });

  it("rejects mixed case", () => {
    expect(validateCategory("RunBook").ok).toBe(false);
  });
});

describe("validateTags / parseTags", () => {
  it("accepts a comma-separated list of slugs", () => {
    expect(validateTags("oncall, ops").ok).toBe(true);
    expect(parseTags("oncall, ops")).toEqual(["oncall", "ops"]);
  });

  it("rejects any non-slug entry", () => {
    expect(validateTags("oncall, Ops").ok).toBe(false);
  });

  it("treats empty input as ok with no tags", () => {
    expect(validateTags("").ok).toBe(true);
    expect(parseTags("")).toEqual([]);
  });
});
