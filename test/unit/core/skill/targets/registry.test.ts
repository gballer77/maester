import { describe, expect, it } from "vitest";
import {
  dedupeTargets,
  getTarget,
  listSkillTargets,
} from "../../../../../src/core/skill/targets/index.js";

describe("skill target registry", () => {
  it("lists exactly the four v1 targets", () => {
    const ids = listSkillTargets().map((t) => t.id);
    expect(ids).toEqual(["claude-code", "codex", "cursor", "agents-md"]);
  });

  it("returns each target by id", () => {
    expect(getTarget("claude-code").label).toBe("Claude Code");
    expect(getTarget("codex").label).toBe("Codex CLI");
    expect(getTarget("cursor").label).toBe("Cursor");
    expect(getTarget("agents-md").label).toBe("Generic AGENTS.md");
  });

  it("throws on an unknown target id", () => {
    // @ts-expect-error testing runtime guard against bad input
    expect(() => getTarget("nonexistent")).toThrow(/Unknown skill target/);
  });
});

describe("dedupeTargets", () => {
  it("collapses codex + generic into one writer group with both labels", () => {
    const groups = dedupeTargets([getTarget("codex"), getTarget("agents-md")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.ids).toEqual(["codex", "agents-md"]);
    expect(groups[0]?.labels).toEqual(["Codex CLI", "Generic AGENTS.md"]);
    expect(groups[0]?.artifactPaths).toEqual(["AGENTS.md"]);
  });

  it("keeps separate writers when their writerKey differs", () => {
    const groups = dedupeTargets([
      getTarget("claude-code"),
      getTarget("cursor"),
      getTarget("codex"),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.writerKey).sort()).toEqual(["agents-md", "claude-code", "cursor"]);
  });

  it("collapses all four targets into three writer groups (claude-code, cursor, agents-md)", () => {
    const groups = dedupeTargets(listSkillTargets());
    expect(groups).toHaveLength(3);
    const byKey = new Map(groups.map((g) => [g.writerKey, g] as const));
    expect(byKey.get("agents-md")?.ids).toEqual(["codex", "agents-md"]);
    expect(byKey.get("claude-code")?.ids).toEqual(["claude-code"]);
    expect(byKey.get("cursor")?.ids).toEqual(["cursor"]);
  });
});
