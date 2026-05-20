import { describe, expect, it } from "vitest";
import { toolName } from "../../../../src/core/connectors/tool-name.js";

describe("toolName", () => {
  it("joins connector and operation with a double underscore", () => {
    expect(toolName("teamgl", "listissues")).toBe("teamgl__listissues");
  });

  it("converts hyphens to underscores on both sides", () => {
    expect(toolName("team-gl", "list-issues")).toBe("team_gl__list_issues");
    expect(toolName("vendor-linear", "get-issue")).toBe("vendor_linear__get_issue");
  });

  it("lowercases both halves", () => {
    expect(toolName("Team-GL", "List-Issues")).toBe("team_gl__list_issues");
  });

  it("preserves digits inside name parts", () => {
    expect(toolName("team-1", "op-2")).toBe("team_1__op_2");
  });

  it("throws when the result would not match /^[a-z][a-z0-9_]*$/", () => {
    expect(() => toolName("0-team", "list-issues")).toThrow(/Invalid MCP tool name/);
    expect(() => toolName("team gl", "op")).toThrow(/Invalid MCP tool name/);
    expect(() => toolName("team", "op.list")).toThrow(/Invalid MCP tool name/);
  });
});
