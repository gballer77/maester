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

  it("Cursor body includes a required-env-vars note when requiredEnvVars is non-empty", () => {
    const body = renderCursorRuleBody({
      ...opts,
      requiredEnvVars: ["GITLAB_TOKEN", "ZULIP_TOKEN"],
    });
    expect(body).toMatch(/Required environment variables \(Cursor\)/);
    expect(body).toMatch(/`GITLAB_TOKEN`/);
    expect(body).toMatch(/`ZULIP_TOKEN`/);
    // Names appear in sorted order regardless of input ordering.
    expect(body).toMatch(/`GITLAB_TOKEN`, `ZULIP_TOKEN`/);
  });

  it("Cursor body omits the required-env-vars note when requiredEnvVars is empty or undefined", () => {
    expect(renderCursorRuleBody(opts)).not.toMatch(/Required environment variables \(Cursor\)/);
    expect(renderCursorRuleBody({ ...opts, requiredEnvVars: [] })).not.toMatch(
      /Required environment variables \(Cursor\)/,
    );
  });

  it("agents-md body includes the fallback CLI policy section", () => {
    const body = renderAgentsMdBody(opts);
    expect(body).toMatch(/Connector tools \(traveling maesters\)/);
    expect(body).toMatch(/maester connector exec/);
  });
});
