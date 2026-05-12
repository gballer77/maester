import { describe, expect, it } from "vitest";
import {
  validateDestination,
  validateEnvVarName,
  validateGitUrl,
  validateSourceName,
} from "../../../../src/core/init/validators.js";

describe("validateSourceName", () => {
  it("accepts a simple kebab-case slug", () => {
    expect(validateSourceName("design-system").ok).toBe(true);
  });

  it("rejects empty input", () => {
    expect(validateSourceName("").ok).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(validateSourceName("DesignSystem").ok).toBe(false);
  });

  it("rejects names starting with a hyphen", () => {
    expect(validateSourceName("-leading").ok).toBe(false);
  });
});

describe("validateGitUrl", () => {
  it("accepts https URLs", () => {
    expect(validateGitUrl("https://github.com/x/y.git").ok).toBe(true);
  });

  it("accepts git@ URLs", () => {
    expect(validateGitUrl("git@github.com:x/y.git").ok).toBe(true);
  });

  it("rejects URLs with whitespace", () => {
    expect(validateGitUrl("https://foo bar.com").ok).toBe(false);
  });

  it("rejects URLs without scheme", () => {
    expect(validateGitUrl("github.com/x/y").ok).toBe(false);
  });
});

describe("validateEnvVarName", () => {
  it("accepts UPPER_SNAKE_CASE names", () => {
    expect(validateEnvVarName("MAESTER_DOCS_TOKEN").ok).toBe(true);
  });

  it("rejects names with whitespace", () => {
    expect(validateEnvVarName("HAS WHITESPACE").ok).toBe(false);
  });

  it("rejects lowercase", () => {
    expect(validateEnvVarName("mixed_Case").ok).toBe(false);
  });

  it("returns ok with warning for token-shaped input", () => {
    const result = validateEnvVarName("AABBCCDDEEFFGGHHIIJJKKLLMMNNOOPPQ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toBeDefined();
    }
  });
});

describe("validateDestination", () => {
  it("accepts blank (means default)", () => {
    expect(validateDestination("").ok).toBe(true);
  });

  it("rejects leading slash", () => {
    expect(validateDestination("/abs").ok).toBe(false);
  });

  it("rejects '..' segments", () => {
    expect(validateDestination("a/../b").ok).toBe(false);
  });

  it("accepts a normal nested path", () => {
    expect(validateDestination("vendor/docs").ok).toBe(true);
  });
});
