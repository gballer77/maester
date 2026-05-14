import { describe, expect, it } from "vitest";
import { buildIncludeEntry } from "../../../../src/cli/commands/init.js";

describe("buildIncludeEntry", () => {
  it("keeps the bare-string form when the user picks 'file header'", () => {
    expect(buildIncludeEntry("docs/**/*.md", "file-header")).toBe("docs/**/*.md");
  });

  it("emits the enriched form with state: draft when the user picks 'draft'", () => {
    expect(buildIncludeEntry("README.md", "draft")).toEqual({
      path: "README.md",
      state: "draft",
    });
  });

  it("emits the enriched form with state: canon when the user picks 'canon'", () => {
    expect(buildIncludeEntry("docs/runbooks/**/*.md", "canon")).toEqual({
      path: "docs/runbooks/**/*.md",
      state: "canon",
    });
  });
});
