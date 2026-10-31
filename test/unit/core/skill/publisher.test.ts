import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listSkillTargets,
  runSkillInstall,
  runSkillStatus,
  runSkillUpgrade,
} from "../../../../src/core/skill/runner.js";
import { SKILL_VERSION } from "../../../../src/core/skill/version.js";

let repoRoot: string;
beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-publisher-skill-"));
});
afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const read = (rel: string) => fs.readFile(path.join(repoRoot, rel), "utf8");
const exists = (rel: string) =>
  fs.access(path.join(repoRoot, rel)).then(
    () => true,
    () => false,
  );

const ALL = ["claude-code", "codex", "cursor", "agents-md"] as const;
const install = (kind: "grand-maester" | "publisher", targets: readonly (typeof ALL)[number][]) =>
  runSkillInstall(repoRoot, { kind, targets, mode: "install", citadelBaseDir: "citadel" });

describe("Publisher skill kind", () => {
  it("writes its own artifact per target, with no MCP registration", async () => {
    const result = await install("publisher", ALL);
    expect(result.outcomes.map((o) => [o.kind, o.id, o.action])).toEqual(
      ALL.map((id) => ["publisher", id, "installed"]),
    );
    expect(result.mcpRegistrations).toEqual([]);
    expect(await exists(".mcp.json")).toBe(false);
    expect(await exists(".claude/settings.json")).toBe(false);

    const skill = await read(".claude/skills/maester-publisher/SKILL.md");
    expect(skill).toMatch(/^---\nname: maester-publisher\ndescription: .+maester\.yaml/);
    expect(skill).toContain(`<!-- maester:publisher:begin v=${SKILL_VERSION} -->`);
    expect(skill).toContain("publish apply --dry-run --json");
    expect(await read(".agents/skills/maester-publisher/SKILL.md")).toBe(skill);
    expect(await read(".cursor/rules/maester-publisher.mdc")).toMatch(
      /^---\ndescription: .+\nglobs: \["maester\.yaml"\]\nalwaysApply: false\n---/,
    );
    expect(await read("AGENTS.md")).toMatch(/^# AGENTS\.md[\s\S]*maester:publisher:begin/);
  });

  it("is idempotent and reports itself through status and upgrade", async () => {
    await install("publisher", ["claude-code"]);
    const again = await install("publisher", ["claude-code"]);
    expect(again.outcomes[0]?.action).toBe("unchanged");

    const status = await runSkillStatus(repoRoot);
    expect(status.outcomes.map((o) => `${o.kind}:${o.id}:${o.state}`)).toEqual([
      "publisher:claude-code:up-to-date",
      "publisher:codex:not-installed",
      "publisher:cursor:not-installed",
      "publisher:agents-md:not-installed",
    ]);

    const file = ".claude/skills/maester-publisher/SKILL.md";
    await fs.writeFile(
      path.join(repoRoot, file),
      (await read(file)).replace(`v=${SKILL_VERSION}`, "v=0.0.1"),
    );
    const check = await runSkillUpgrade(repoRoot, { check: true, citadelBaseDir: "citadel" });
    expect(check.outcomes.map((o) => [o.kind, o.action])).toEqual([["publisher", "upgraded"]]);
    const upgraded = await runSkillUpgrade(repoRoot, { citadelBaseDir: "citadel" });
    expect(upgraded.outcomes[0]?.action).toBe("upgraded");
    expect(upgraded.mcpRegistrations).toEqual([]);
    expect(await read(file)).toContain(`v=${SKILL_VERSION}`);
  });

  it("shares AGENTS.md with the Grand Maester; upgrading one region leaves the other intact", async () => {
    await fs.writeFile(path.join(repoRoot, "AGENTS.md"), "# Team notes\n\nKeep this.\n");
    await install("grand-maester", ["agents-md"]);
    await install("publisher", ["agents-md"]);
    let text = await read("AGENTS.md");
    expect(text.startsWith("# Team notes\n\nKeep this.\n")).toBe(true);
    expect(text).toContain("<!-- maester:skill:begin");
    expect(text).toContain("<!-- maester:publisher:begin");

    const grandRegion = /<!-- maester:skill:begin[\s\S]*?<!-- maester:skill:end -->/;
    const before = grandRegion.exec(text)?.[0];
    await fs.writeFile(
      path.join(repoRoot, "AGENTS.md"),
      text.replace(`maester:publisher:begin v=${SKILL_VERSION}`, "maester:publisher:begin v=0.0.1"),
    );
    await runSkillUpgrade(repoRoot, { kinds: ["publisher"], citadelBaseDir: "citadel" });
    text = await read("AGENTS.md");
    expect(grandRegion.exec(text)?.[0]).toBe(before);
    expect(text).toContain(`maester:publisher:begin v=${SKILL_VERSION}`);

    const status = await runSkillStatus(repoRoot);
    expect(status.outcomes.filter((o) => o.state === "up-to-date").map((o) => o.kind)).toEqual([
      "grand-maester",
      "publisher",
    ]);
  });

  it("instructs vocabulary reuse, labelling new values, and stating the state choice", async () => {
    await install("publisher", ["claude-code"]);
    const skill = await read(".claude/skills/maester-publisher/SKILL.md");
    expect(skill).toContain("publish inventory --json");
    expect(skill).toMatch(/Reuse before you invent/);
    expect(skill).toContain("`(new)`");
    expect(skill).toMatch(/`canon`[\s\S]*`draft`[\s\S]*file header/);
    expect(skill).toMatch(/Say which state you chose for each entry/);
  });

  it("encodes the create and refine workflows and the hard rules on every target", async () => {
    await install("publisher", ALL);
    for (const file of [
      ".claude/skills/maester-publisher/SKILL.md",
      ".agents/skills/maester-publisher/SKILL.md",
      ".cursor/rules/maester-publisher.mdc",
      "AGENTS.md",
    ]) {
      const text = await read(file);
      // grounding, validate-before-showing, write
      expect(text).toContain("publish list --json");
      expect(text).toContain("publish inventory --json");
      expect(text).toContain("publish apply --dry-run --json");
      expect(text).toMatch(/publish apply --json/);
      // hard rules
      expect(text).toMatch(/Never edit `maester\.yaml` by hand/);
      expect(text).toMatch(/Never edit document content/);
      expect(text).toMatch(/Write nothing until the user approves/);
      expect(text).toMatch(/Never set `allowSensitive` unless the user/);
      // create mode: whole proposal with rationale, exclusions, narrowing notice
      expect(text).toMatch(/\*\*Create mode\*\*/);
      expect(text).toMatch(/\*\*rationale\*\*/);
      expect(text).toMatch(/\*\*exclusions\*\*/);
      expect(text).toMatch(/narrowing notice/);
      expect(text).toMatch(/If they decline, write nothing/);
      // refine mode: grouped changes; modifications approved one by one
      expect(text).toMatch(/\*\*Refine mode\*\*/);
      expect(text).toMatch(/\*\*Additions\*\*[\s\S]*\*\*Removals\*\*[\s\S]*\*\*Fill-ins\*\*/);
      expect(text).toMatch(/\*\*modification\*\*[\s\S]*explicit approval for\s+each one/);
      expect(text).toMatch(/declined items are never written/);
      expect(text).toMatch(/git diff/);
    }
  });

  it("leaves the default target list (used by MCP registration) Grand-Maester only", () => {
    expect(listSkillTargets().map((t) => t.artifactPaths[0])).not.toContain(
      ".claude/skills/maester-publisher/SKILL.md",
    );
    expect(listSkillTargets("publisher")).toHaveLength(4);
  });
});
