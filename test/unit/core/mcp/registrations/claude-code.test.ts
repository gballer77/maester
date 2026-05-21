import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeClaudeCodeMcpEntry } from "../../../../../src/core/mcp/registrations/claude-code.js";

let repoRoot: string;
const launch = { command: "/fake/path/to/maester", args: ["mcp"] };

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-mcp-cc-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("writeClaudeCodeMcpEntry", () => {
  it("creates .mcp.json with the maester entry on a fresh repo", async () => {
    const out = await writeClaudeCodeMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("written");
    const text = await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8");
    const parsed = JSON.parse(text);
    expect(parsed.mcpServers.maester).toEqual({
      command: "/fake/path/to/maester",
      args: ["mcp"],
    });
  });

  it("is idempotent — second identical write returns 'unchanged'", async () => {
    await writeClaudeCodeMcpEntry(repoRoot, { launch });
    const first = await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8");
    const out = await writeClaudeCodeMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("unchanged");
    const second = await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8");
    expect(second).toBe(first);
  });

  it("preserves other mcpServers entries", async () => {
    const existing = JSON.stringify(
      {
        mcpServers: {
          other: { command: "node", args: ["other.js"] },
          maester: { command: "stale", args: [] },
        },
      },
      null,
      2,
    );
    await fs.writeFile(path.join(repoRoot, ".mcp.json"), `${existing}\n`, "utf8");
    await writeClaudeCodeMcpEntry(repoRoot, { launch });
    const parsed = JSON.parse(await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8"));
    expect(parsed.mcpServers.other).toEqual({ command: "node", args: ["other.js"] });
    expect(parsed.mcpServers.maester).toEqual({
      command: "/fake/path/to/maester",
      args: ["mcp"],
    });
  });

  it("preserves other top-level keys", async () => {
    await fs.writeFile(
      path.join(repoRoot, ".mcp.json"),
      `${JSON.stringify({ globalSettings: { foo: true }, mcpServers: {} }, null, 2)}\n`,
      "utf8",
    );
    await writeClaudeCodeMcpEntry(repoRoot, { launch });
    const parsed = JSON.parse(await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8"));
    expect(parsed.globalSettings).toEqual({ foo: true });
    expect(parsed.mcpServers.maester).toBeDefined();
  });

  describe("connector env-var seeding", () => {
    const readMaester = async (): Promise<Record<string, unknown>> => {
      const parsed = JSON.parse(await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8"));
      return parsed.mcpServers.maester;
    };

    it("emits env object with ${VAR:-} placeholders and a managed-marker", async () => {
      await writeClaudeCodeMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["ZULIP_TOKEN", "GITLAB_TOKEN"],
      });
      const m = await readMaester();
      expect(m.env).toEqual({
        GITLAB_TOKEN: "${GITLAB_TOKEN:-}",
        ZULIP_TOKEN: "${ZULIP_TOKEN:-}",
      });
      expect(m._maesterManagedEnv).toEqual(["GITLAB_TOKEN", "ZULIP_TOKEN"]);
    });

    it("omits env and the marker when no managed names and no user-added entries", async () => {
      await writeClaudeCodeMcpEntry(repoRoot, { launch, connectorEnvVars: [] });
      const m = await readMaester();
      expect(m.env).toBeUndefined();
      expect(m._maesterManagedEnv).toBeUndefined();
    });

    it("preserves user-added env keys on refresh (union semantics)", async () => {
      await fs.writeFile(
        path.join(repoRoot, ".mcp.json"),
        `${JSON.stringify(
          {
            mcpServers: {
              maester: {
                command: "old",
                args: [],
                env: { MY_DEBUG: "1" },
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await writeClaudeCodeMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["GITLAB_TOKEN"],
      });
      const m = await readMaester();
      expect(m.env).toEqual({
        GITLAB_TOKEN: "${GITLAB_TOKEN:-}",
        MY_DEBUG: "1",
      });
      expect(m._maesterManagedEnv).toEqual(["GITLAB_TOKEN"]);
    });

    it("overwrites a stale managed value with the placeholder on refresh", async () => {
      await fs.writeFile(
        path.join(repoRoot, ".mcp.json"),
        `${JSON.stringify(
          {
            mcpServers: {
              maester: {
                command: "old",
                args: [],
                env: { GITLAB_TOKEN: "literal-value-was-here" },
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await writeClaudeCodeMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["GITLAB_TOKEN"],
      });
      const m = await readMaester();
      expect((m.env as Record<string, string>).GITLAB_TOKEN).toBe("${GITLAB_TOKEN:-}");
    });

    it("removes managed keys from env when a connector is removed (next refresh)", async () => {
      await writeClaudeCodeMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["GITLAB_TOKEN"],
      });
      await writeClaudeCodeMcpEntry(repoRoot, { launch, connectorEnvVars: [] });
      const m = await readMaester();
      expect(m.env).toBeUndefined();
      expect(m._maesterManagedEnv).toBeUndefined();
    });

    it("removes managed keys but preserves user-added ones after connector removal", async () => {
      // First refresh adds GITLAB_TOKEN as managed.
      await writeClaudeCodeMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["GITLAB_TOKEN"],
      });
      // User then adds MY_DEBUG by hand.
      const parsed = JSON.parse(await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8"));
      parsed.mcpServers.maester.env.MY_DEBUG = "1";
      await fs.writeFile(
        path.join(repoRoot, ".mcp.json"),
        `${JSON.stringify(parsed, null, 2)}\n`,
        "utf8",
      );
      // Now remove the connector — managed shrinks to []; user entry survives.
      await writeClaudeCodeMcpEntry(repoRoot, { launch, connectorEnvVars: [] });
      const m = await readMaester();
      expect(m.env).toEqual({ MY_DEBUG: "1" });
      expect(m._maesterManagedEnv).toBeUndefined();
    });

    it("is idempotent with env present", async () => {
      await writeClaudeCodeMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["GITLAB_TOKEN"],
      });
      const first = await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8");
      const out = await writeClaudeCodeMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["GITLAB_TOKEN"],
      });
      expect(out.action).toBe("unchanged");
      const second = await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8");
      expect(second).toBe(first);
    });
  });
});
