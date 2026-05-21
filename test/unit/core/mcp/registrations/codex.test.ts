import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCodexMcpEntry } from "../../../../../src/core/mcp/registrations/codex.js";

let repoRoot: string;
const launch = { command: "/fake/path/to/maester", args: ["mcp"] };

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-mcp-codex-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const configPath = (): string => path.join(repoRoot, ".codex", "config.toml");

describe("writeCodexMcpEntry", () => {
  it("creates <repo>/.codex/config.toml with [mcp_servers.maester] containing only the resolved command", async () => {
    const out = await writeCodexMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("written");
    expect(out.filePath).toBe(configPath());
    const parsed = TOML.parse(await fs.readFile(configPath(), "utf8"));
    expect(parsed.mcp_servers).toEqual({
      maester: { command: "/fake/path/to/maester", args: ["mcp"] },
    });
  });

  it("is idempotent on a second write", async () => {
    await writeCodexMcpEntry(repoRoot, { launch });
    const out = await writeCodexMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("unchanged");
  });

  it("preserves other top-level tables and other mcp_servers entries", async () => {
    await fs.mkdir(path.join(repoRoot, ".codex"), { recursive: true });
    const seed = TOML.stringify({
      model: { name: "gpt-4" },
      mcp_servers: { other: { command: "node", args: ["other.js"] } },
    });
    await fs.writeFile(configPath(), seed, "utf8");
    await writeCodexMcpEntry(repoRoot, { launch });
    const parsed = TOML.parse(await fs.readFile(configPath(), "utf8"));
    expect(parsed.model).toEqual({ name: "gpt-4" });
    expect(parsed.mcp_servers).toEqual({
      other: { command: "node", args: ["other.js"] },
      maester: { command: "/fake/path/to/maester", args: ["mcp"] },
    });
  });

  it("rewrites a stale maester block (e.g. when the binary path changes)", async () => {
    await writeCodexMcpEntry(repoRoot, {
      launch: { command: "/old/path/maester", args: ["mcp"] },
    });
    const out = await writeCodexMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("written");
    const parsed = TOML.parse(await fs.readFile(configPath(), "utf8"));
    expect(parsed.mcp_servers).toEqual({
      maester: { command: "/fake/path/to/maester", args: ["mcp"] },
    });
  });

  describe("connector env-var seeding", () => {
    const readMaester = async (): Promise<Record<string, unknown>> => {
      const parsed = TOML.parse(await fs.readFile(configPath(), "utf8")) as {
        mcp_servers: { maester: Record<string, unknown> };
      };
      return parsed.mcp_servers.maester;
    };

    it("emits env_vars and a managed-marker when connectorEnvVars is non-empty", async () => {
      await writeCodexMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["ZULIP_TOKEN", "GITLAB_TOKEN"],
      });
      const m = await readMaester();
      // Stable-sorted regardless of input order.
      expect(m.env_vars).toEqual(["GITLAB_TOKEN", "ZULIP_TOKEN"]);
      expect(m._maester_managed_env_vars).toEqual(["GITLAB_TOKEN", "ZULIP_TOKEN"]);
    });

    it("omits env_vars and the marker when no managed names and no user-added entries", async () => {
      await writeCodexMcpEntry(repoRoot, { launch, connectorEnvVars: [] });
      const m = await readMaester();
      expect(m.env_vars).toBeUndefined();
      expect(m._maester_managed_env_vars).toBeUndefined();
    });

    it("preserves user-added env_vars entries on refresh (union semantics)", async () => {
      // Seed without a marker — the writer treats all existing entries as
      // user-added when no marker is present.
      await fs.mkdir(path.join(repoRoot, ".codex"), { recursive: true });
      await fs.writeFile(
        configPath(),
        TOML.stringify({
          mcp_servers: {
            maester: { command: "old", args: [], env_vars: ["MY_DEBUG"] },
          },
        }),
        "utf8",
      );
      await writeCodexMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["GITLAB_TOKEN"],
      });
      const m = await readMaester();
      expect(m.env_vars).toEqual(["GITLAB_TOKEN", "MY_DEBUG"]);
      expect(m._maester_managed_env_vars).toEqual(["GITLAB_TOKEN"]);
    });

    it("removes managed names from env_vars when a connector is removed (next refresh)", async () => {
      await writeCodexMcpEntry(repoRoot, { launch, connectorEnvVars: ["GITLAB_TOKEN"] });
      // Simulate connector removal — next refresh has an empty managed set.
      await writeCodexMcpEntry(repoRoot, { launch, connectorEnvVars: [] });
      const m = await readMaester();
      expect(m.env_vars).toBeUndefined();
      expect(m._maester_managed_env_vars).toBeUndefined();
    });

    it("removes managed names but preserves user-added ones after connector removal", async () => {
      // First refresh adds GITLAB_TOKEN as managed. User then adds MY_DEBUG by hand.
      await writeCodexMcpEntry(repoRoot, { launch, connectorEnvVars: ["GITLAB_TOKEN"] });
      const parsed = TOML.parse(await fs.readFile(configPath(), "utf8"));
      const servers = parsed.mcp_servers as TOML.JsonMap;
      const maester = servers.maester as TOML.JsonMap;
      maester.env_vars = ["GITLAB_TOKEN", "MY_DEBUG"];
      await fs.writeFile(configPath(), TOML.stringify(parsed), "utf8");

      // Now remove the connector — managed shrinks to []; user entry survives.
      await writeCodexMcpEntry(repoRoot, { launch, connectorEnvVars: [] });
      const m = await readMaester();
      expect(m.env_vars).toEqual(["MY_DEBUG"]);
      expect(m._maester_managed_env_vars).toBeUndefined();
    });

    it("dedupes when managed and user-added overlap", async () => {
      await fs.mkdir(path.join(repoRoot, ".codex"), { recursive: true });
      await fs.writeFile(
        configPath(),
        TOML.stringify({
          mcp_servers: {
            maester: { command: "old", args: [], env_vars: ["GITLAB_TOKEN"] },
          },
        }),
        "utf8",
      );
      await writeCodexMcpEntry(repoRoot, { launch, connectorEnvVars: ["GITLAB_TOKEN"] });
      const m = await readMaester();
      expect(m.env_vars).toEqual(["GITLAB_TOKEN"]);
      expect(m._maester_managed_env_vars).toEqual(["GITLAB_TOKEN"]);
    });

    it("is idempotent with env_vars present", async () => {
      await writeCodexMcpEntry(repoRoot, { launch, connectorEnvVars: ["GITLAB_TOKEN"] });
      const out = await writeCodexMcpEntry(repoRoot, {
        launch,
        connectorEnvVars: ["GITLAB_TOKEN"],
      });
      expect(out.action).toBe("unchanged");
    });
  });
});
