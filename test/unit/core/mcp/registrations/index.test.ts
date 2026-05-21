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

  it("seeds connector env-vars from citadel.yaml into Codex and Claude Code, but not Cursor", async () => {
    await writeCitadelWithConnector(repoRoot, "GITLAB_TOKEN");
    await refreshMcpRegistrations(repoRoot, {
      scopeTo: ["codex", "claude-code", "cursor"],
    });

    const codex = await readCodexMaester(repoRoot);
    expect(codex.env_vars).toEqual(["GITLAB_TOKEN"]);

    const cc = await readJsonMaester(path.join(repoRoot, ".mcp.json"));
    expect(cc.env).toEqual({ GITLAB_TOKEN: "${GITLAB_TOKEN:-}" });

    const cursor = await readJsonMaester(path.join(repoRoot, ".cursor", "mcp.json"));
    expect(cursor.env).toBeUndefined();
  });

  it("does not break refresh when citadel.yaml is missing", async () => {
    const outcomes = await refreshMcpRegistrations(repoRoot, { scopeTo: ["codex"] });
    expect(outcomes[0]?.action).toBe("written");
    const codex = await readCodexMaester(repoRoot);
    expect(codex.env_vars).toBeUndefined();
  });

  it("produces byte-identical files when connector ordering is reshuffled", async () => {
    await writeCitadelWithConnectors(repoRoot, [
      { name: "a", env: "ZZZ_TOKEN" },
      { name: "b", env: "AAA_TOKEN" },
    ]);
    await refreshMcpRegistrations(repoRoot, { scopeTo: ["codex"] });
    const first = await fs.readFile(path.join(repoRoot, ".codex", "config.toml"), "utf8");

    // Same set of env vars but declared in a different order — output must be identical.
    await writeCitadelWithConnectors(repoRoot, [
      { name: "b", env: "AAA_TOKEN" },
      { name: "a", env: "ZZZ_TOKEN" },
    ]);
    await refreshMcpRegistrations(repoRoot, { scopeTo: ["codex"] });
    const second = await fs.readFile(path.join(repoRoot, ".codex", "config.toml"), "utf8");

    expect(second).toBe(first);
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

async function writeCitadelWithConnector(repoRoot: string, envVar: string): Promise<void> {
  await writeCitadelWithConnectors(repoRoot, [{ name: "gl", env: envVar }]);
}

async function writeCitadelWithConnectors(
  repoRoot: string,
  entries: readonly { name: string; env: string }[],
): Promise<void> {
  const lines = [
    "schemaVersion: 1",
    "sources:",
    "  - name: src",
    "    url: https://github.com/x/y",
    "connectors:",
  ];
  for (const e of entries) {
    lines.push(
      `  - name: ${e.name}`,
      "    type: gitlab-issues",
      "    auth:",
      "      type: token",
      `      envVar: ${e.env}`,
      "    config:",
      "      project: g/p",
    );
  }
  await fs.writeFile(path.join(repoRoot, "citadel.yaml"), `${lines.join("\n")}\n`, "utf8");
}

async function readCodexMaester(repoRoot: string): Promise<Record<string, unknown>> {
  const { default: TOML } = await import("@iarna/toml");
  const text = await fs.readFile(path.join(repoRoot, ".codex", "config.toml"), "utf8");
  const parsed = TOML.parse(text) as {
    mcp_servers: { maester: Record<string, unknown> };
  };
  return parsed.mcp_servers.maester;
}

async function readJsonMaester(p: string): Promise<Record<string, unknown>> {
  const text = await fs.readFile(p, "utf8");
  const parsed = JSON.parse(text) as {
    mcpServers: { maester: Record<string, unknown> };
  };
  return parsed.mcpServers.maester;
}
