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
  it("keeps codex and agents-md in separate writer groups (distinct artifacts)", () => {
    const groups = dedupeTargets([getTarget("codex"), getTarget("agents-md")]);
    expect(groups).toHaveLength(2);
    const byKey = new Map(groups.map((g) => [g.writerKey, g] as const));
    expect(byKey.get("codex")?.ids).toEqual(["codex"]);
    expect(byKey.get("codex")?.artifactPaths).toEqual([".agents/skills/grand-maester/SKILL.md"]);
    expect(byKey.get("agents-md")?.ids).toEqual(["agents-md"]);
    expect(byKey.get("agents-md")?.artifactPaths).toEqual(["AGENTS.md"]);
  });

  it("keeps separate writers when their writerKey differs", () => {
    const groups = dedupeTargets([
      getTarget("claude-code"),
      getTarget("cursor"),
      getTarget("codex"),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.writerKey).sort()).toEqual(["claude-code", "codex", "cursor"]);
  });

  it("keeps all four targets in four distinct writer groups", () => {
    const groups = dedupeTargets(listSkillTargets());
    expect(groups).toHaveLength(4);
    const byKey = new Map(groups.map((g) => [g.writerKey, g] as const));
    expect(byKey.get("claude-code")?.ids).toEqual(["claude-code"]);
    expect(byKey.get("codex")?.ids).toEqual(["codex"]);
    expect(byKey.get("cursor")?.ids).toEqual(["cursor"]);
    expect(byKey.get("agents-md")?.ids).toEqual(["agents-md"]);
  });
});
