import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runSkillInstall,
  runSkillStatus,
  runSkillUpgrade,
} from "../../../../src/core/skill/runner.js";
import { SKILL_VERSION } from "../../../../src/core/skill/version.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-skill-runner-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("runSkillInstall", () => {
  it("installs a single target and reports an installed outcome", async () => {
    const result = await runSkillInstall(repoRoot, {
      targets: ["claude-code"],
      mode: "install",
      citadelBaseDir: "citadel",
    });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.action).toBe("installed");
    expect(result.counts).toEqual({ installed: 1, upgraded: 0, unchanged: 0, failed: 0 });
    expect(await fileExists(path.join(repoRoot, ".claude/skills/grand-maester/SKILL.md"))).toBe(
      true,
    );
  });

  it("writes codex and agents-md to separate artifacts", async () => {
    const result = await runSkillInstall(repoRoot, {
      targets: ["codex", "agents-md"],
      mode: "install",
      citadelBaseDir: "citadel",
    });
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.map((o) => o.id).sort()).toEqual(["agents-md", "codex"]);
    const byId = Object.fromEntries(result.outcomes.map((o) => [o.id, o]));
    expect(byId.codex?.artifactPaths).toEqual([".agents/skills/grand-maester/SKILL.md"]);
    expect(byId["agents-md"]?.artifactPaths).toEqual(["AGENTS.md"]);
    expect(await fileExists(path.join(repoRoot, ".agents/skills/grand-maester/SKILL.md"))).toBe(
      true,
    );
    expect(await fileExists(path.join(repoRoot, "AGENTS.md"))).toBe(true);
  });

  it("rejects an unknown target id before any write", async () => {
    await expect(
      runSkillInstall(repoRoot, {
        targets: ["nonexistent"] as unknown as ["claude-code"],
        mode: "install",
        citadelBaseDir: "citadel",
      }),
    ).rejects.toThrow(/Unknown skill target/);
    expect(await fileExists(path.join(repoRoot, "AGENTS.md"))).toBe(false);
  });

  it("rejects an empty target list", async () => {
    await expect(
      runSkillInstall(repoRoot, { targets: [], mode: "install", citadelBaseDir: "citadel" }),
    ).rejects.toThrow();
  });

  it("reports unchanged on a second identical install", async () => {
    await runSkillInstall(repoRoot, {
      targets: ["cursor"],
      mode: "install",
      citadelBaseDir: "citadel",
    });
    const second = await runSkillInstall(repoRoot, {
      targets: ["cursor"],
      mode: "install",
      citadelBaseDir: "citadel",
    });
    expect(second.outcomes[0]?.action).toBe("unchanged");
    expect(second.counts.unchanged).toBe(1);
  });
});

describe("runSkillStatus", () => {
  it("reports every target as not-installed on a fresh repo", async () => {
    const result = await runSkillStatus(repoRoot);
    expect(result.outcomes).toHaveLength(4);
    expect(result.counts.notInstalled).toBe(4);
    expect(result.counts.upToDate).toBe(0);
    for (const o of result.outcomes) {
      expect(o.state).toBe("not-installed");
      expect(o.installedVersion).toBeUndefined();
      expect(o.currentVersion).toBe(SKILL_VERSION);
    }
  });

  it("reports up-to-date after a fresh install", async () => {
    await runSkillInstall(repoRoot, {
      targets: ["claude-code", "codex"],
      mode: "install",
      citadelBaseDir: "citadel",
    });
    const result = await runSkillStatus(repoRoot);
    const byId = Object.fromEntries(result.outcomes.map((o) => [o.id, o]));
    expect(byId["claude-code"]?.state).toBe("up-to-date");
    expect(byId.codex?.state).toBe("up-to-date");
    expect(byId.cursor?.state).toBe("not-installed");
    // agents-md writes its own artifact (AGENTS.md), so it remains not-installed
    expect(byId["agents-md"]?.state).toBe("not-installed");
  });

  it("reports outdated when a target's installed marker differs from SKILL_VERSION", async () => {
    // Plant a stale AGENTS.md so agents-md reports as outdated.
    const stale =
      "# AGENTS.md\n\n<!-- maester:skill:begin v=0.0.1 -->\nold body\n<!-- maester:skill:end -->\n";
    await fs.writeFile(path.join(repoRoot, "AGENTS.md"), stale, "utf8");
    const result = await runSkillStatus(repoRoot);
    const agentsMd = result.outcomes.find((o) => o.id === "agents-md");
    expect(agentsMd?.state).toBe("outdated");
    expect(agentsMd?.installedVersion).toBe("0.0.1");
  });
});

describe("runSkillUpgrade", () => {
  it("refreshes only installed targets", async () => {
    await runSkillInstall(repoRoot, {
      targets: ["cursor"],
      mode: "install",
      citadelBaseDir: "citadel",
    });
    const result = await runSkillUpgrade(repoRoot, { citadelBaseDir: "citadel" });
    // Only cursor is installed, so only it should appear
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.id).toBe("cursor");
  });

  it("returns no outcomes when nothing is installed", async () => {
    const result = await runSkillUpgrade(repoRoot, { citadelBaseDir: "citadel" });
    expect(result.outcomes).toHaveLength(0);
    expect(result.counts.installed + result.counts.upgraded).toBe(0);
  });

  it("upgrades outdated installed targets", async () => {
    // Plant a stale AGENTS.md
    const stale =
      "# AGENTS.md\n\n<!-- maester:skill:begin v=0.0.1 -->\nold body\n<!-- maester:skill:end -->\n";
    await fs.writeFile(path.join(repoRoot, "AGENTS.md"), stale, "utf8");
    const result = await runSkillUpgrade(repoRoot, { citadelBaseDir: "citadel" });
    expect(result.outcomes.length).toBeGreaterThan(0);
    const text = await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
    expect(text).toContain(`v=${SKILL_VERSION}`);
    expect(text).not.toContain("v=0.0.1");
  });

  it("--check does not write to disk", async () => {
    const stale =
      "# AGENTS.md\n\n<!-- maester:skill:begin v=0.0.1 -->\nold body\n<!-- maester:skill:end -->\n";
    const agentsPath = path.join(repoRoot, "AGENTS.md");
    await fs.writeFile(agentsPath, stale, "utf8");
    const result = await runSkillUpgrade(repoRoot, { check: true, citadelBaseDir: "citadel" });
    const reread = await fs.readFile(agentsPath, "utf8");
    expect(reread).toBe(stale);
    // Outcomes still report what would change
    const agentsMd = result.outcomes.find((o) => o.id === "agents-md");
    expect(agentsMd?.action).toBe("upgraded");
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
