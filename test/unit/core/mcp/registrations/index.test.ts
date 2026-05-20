import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refreshMcpRegistrations } from "../../../../../src/core/mcp/registrations/index.js";
import { runSkillInstall } from "../../../../../src/core/skill/runner.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-refresh-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("refreshMcpRegistrations", () => {
  it("returns no outcomes on a fresh repo with no Grand Maester targets installed", async () => {
    const outcomes = await refreshMcpRegistrations(repoRoot);
    expect(outcomes).toEqual([]);
  });

  it("refreshes only installed targets when no scope is supplied", async () => {
    // Install Claude Code and Codex but NOT Cursor.
    await runSkillInstall(repoRoot, {
      targets: ["claude-code", "codex"],
      mode: "install",
      citadelBaseDir: "citadel",
    });
    const outcomes = await refreshMcpRegistrations(repoRoot);
    const hosts = outcomes.map((o) => o.host).sort();
    expect(hosts).toEqual(["claude-code", "codex"]);
    // Files exist where expected
    expect(await fileExists(path.join(repoRoot, ".mcp.json"))).toBe(true);
    expect(await fileExists(path.join(repoRoot, ".codex", "config.toml"))).toBe(true);
    expect(await fileExists(path.join(repoRoot, ".cursor", "mcp.json"))).toBe(false);
  });

  it("honors scopeTo and refreshes even when the target isn't installed yet", async () => {
    const outcomes = await refreshMcpRegistrations(repoRoot, { scopeTo: ["cursor"] });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.host).toBe("cursor");
    expect(outcomes[0]?.action).toBe("written");
    expect(await fileExists(path.join(repoRoot, ".cursor", "mcp.json"))).toBe(true);
  });

  it("never refreshes the agents-md target (not an MCP host)", async () => {
    await runSkillInstall(repoRoot, {
      targets: ["agents-md"],
      mode: "install",
      citadelBaseDir: "citadel",
    });
    const outcomes = await refreshMcpRegistrations(repoRoot);
    expect(outcomes).toEqual([]);
    expect(await fileExists(path.join(repoRoot, ".mcp.json"))).toBe(false);
  });
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
