import { describe, expect, it } from "vitest";
import { renderAgentsMdBody } from "../../../../../src/core/skill/templates/shells/agents-md.js";
import { renderClaudeSkillBody } from "../../../../../src/core/skill/templates/shells/claude-code.js";
import { renderCodexSkillBody } from "../../../../../src/core/skill/templates/shells/codex.js";
import { renderCursorRuleBody } from "../../../../../src/core/skill/templates/shells/cursor.js";

const opts = { baseDir: "citadel" };

describe("connector policy fragments in target shells", () => {
  it("Claude Code body includes the connector tools section", () => {
    const body = renderClaudeSkillBody(opts);
    expect(body).toMatch(/Connector tools \(traveling maesters\)/);
    expect(body).toMatch(/MCP tools/);
  });

  it("Codex body includes the connector tools section", () => {
    const body = renderCodexSkillBody(opts);
    expect(body).toMatch(/Connector tools \(traveling maesters\)/);
  });

  it("Cursor body includes the connector tools section", () => {
    const body = renderCursorRuleBody(opts);
    expect(body).toMatch(/Connector tools \(traveling maesters\)/);
  });

  it("agents-md body includes the fallback CLI policy section", () => {
    const body = renderAgentsMdBody(opts);
    expect(body).toMatch(/Connector tools \(traveling maesters\)/);
    expect(body).toMatch(/maester connector exec/);
  });
});
