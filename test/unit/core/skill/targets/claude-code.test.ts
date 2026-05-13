import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeCodeTarget } from "../../../../../src/core/skill/targets/claude-code.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-skill-cc-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const input = (overrides: Partial<{ version: string; baseDir: string }> = {}) => ({
  repoRoot,
  skillVersion: overrides.version ?? "1.0.0",
  citadelBaseDir: overrides.baseDir ?? "citadel",
});

describe("claudeCodeTarget.write", () => {
  it("installs SKILL.md and a settings.json maester block", async () => {
    const outcome = await claudeCodeTarget.write(input());
    expect(outcome.action).toBe("installed");

    const skillMd = await fs.readFile(
      path.join(repoRoot, ".claude/skills/grand-maester/SKILL.md"),
      "utf8",
    );
    expect(skillMd).toContain("name: grand-maester");
    expect(skillMd).toContain("<!-- maester:skill:begin v=1.0.0 -->");

    const settingsRaw = await fs.readFile(path.join(repoRoot, ".claude/settings.json"), "utf8");
    const settings = JSON.parse(settingsRaw) as Record<string, unknown>;
    expect(settings.maester).toBeDefined();
    const maester = settings.maester as Record<string, unknown>;
    expect(maester.version).toBe("1.0.0");
    const hooks = maester.hooks as Record<string, unknown>;
    const pre = hooks.PreToolUse as Array<Record<string, unknown>>;
    expect(pre[0]?.matcher).toBe("Read|Glob|Grep");
  });

  it("is idempotent on a second identical write", async () => {
    await claudeCodeTarget.write(input());
    const skillMd1 = await fs.readFile(
      path.join(repoRoot, ".claude/skills/grand-maester/SKILL.md"),
      "utf8",
    );
    const settings1 = await fs.readFile(path.join(repoRoot, ".claude/settings.json"), "utf8");

    const outcome = await claudeCodeTarget.write(input());
    expect(outcome.action).toBe("unchanged");

    const skillMd2 = await fs.readFile(
      path.join(repoRoot, ".claude/skills/grand-maester/SKILL.md"),
      "utf8",
    );
    const settings2 = await fs.readFile(path.join(repoRoot, ".claude/settings.json"), "utf8");
    expect(skillMd2).toBe(skillMd1);
    expect(settings2).toBe(settings1);
  });

  it("preserves unrelated keys in settings.json on upgrade", async () => {
    const settingsPath = path.join(repoRoot, ".claude/settings.json");
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] }, env: { FOO: "bar" } }, null, 2),
      "utf8",
    );

    const outcome = await claudeCodeTarget.write(input());
    expect(outcome.action).toBe("installed");
    const next = JSON.parse(await fs.readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(next)).toEqual(["permissions", "env", "maester"]);
    expect((next.permissions as Record<string, unknown>).allow).toEqual(["Bash(ls:*)"]);
  });

  it("upgrades the version marker on a SKILL.md from an older release", async () => {
    await claudeCodeTarget.write(input({ version: "0.1.0" }));
    const outcome = await claudeCodeTarget.write(input({ version: "0.2.0" }));
    expect(outcome.action).toBe("upgraded");
    const skillMd = await fs.readFile(
      path.join(repoRoot, ".claude/skills/grand-maester/SKILL.md"),
      "utf8",
    );
    expect(skillMd).toContain("<!-- maester:skill:begin v=0.2.0 -->");
  });

  it("reads back the installed version from SKILL.md", async () => {
    expect(await claudeCodeTarget.readInstalledVersion(repoRoot)).toBeUndefined();
    await claudeCodeTarget.write(input({ version: "3.4.5" }));
    expect(await claudeCodeTarget.readInstalledVersion(repoRoot)).toBe("3.4.5");
  });
});
