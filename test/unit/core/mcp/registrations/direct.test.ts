import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderDirectEntries } from "../../../../../src/core/mcp/registrations/direct.js";
import { refreshMcpRegistrations } from "../../../../../src/core/mcp/registrations/index.js";
import type { McpServer } from "../../../../../src/schemas/citadel.js";

const localServer = {
  name: "code-host",
  kind: "local",
  command: "npx",
  args: ["-y", "@example/code-host-mcp"],
  envVars: ["CODE_HOST_TOKEN"],
  register: "direct",
} as McpServer;
const remoteBearer = {
  name: "tracker",
  kind: "remote",
  url: "https://mcp.tracker.example.com/mcp",
  auth: { envVar: "TRACKER_TOKEN" },
  register: "direct",
} as McpServer;
const remoteHeader = {
  name: "keyed",
  kind: "remote",
  url: "https://k.example.com/mcp",
  auth: { envVar: "K_KEY", header: "X-Api-Key" },
  register: "direct",
} as McpServer;
const remoteOpen = {
  name: "wiki",
  kind: "remote",
  url: "https://w.example.com/mcp",
  register: "direct",
} as McpServer;

describe("renderDirectEntries", () => {
  it("renders Claude Code entries with ${NAME} references only", () => {
    const { entries, skipped } = renderDirectEntries("claude-code", [
      localServer,
      remoteBearer,
      remoteHeader,
    ]);
    expect(skipped).toEqual([]);
    expect(Object.fromEntries(entries)).toEqual({
      "code-host": {
        command: "npx",
        args: ["-y", "@example/code-host-mcp"],
        env: { CODE_HOST_TOKEN: "${CODE_HOST_TOKEN:-}" },
      },
      tracker: {
        type: "http",
        url: "https://mcp.tracker.example.com/mcp",
        headers: { Authorization: "Bearer ${TRACKER_TOKEN}" },
      },
      keyed: {
        type: "http",
        url: "https://k.example.com/mcp",
        headers: { "X-Api-Key": "${K_KEY}" },
      },
    });
  });

  it("renders Codex entries with env-var names", () => {
    const { entries } = renderDirectEntries("codex", [localServer, remoteBearer, remoteHeader]);
    expect(Object.fromEntries(entries)).toEqual({
      "code-host": {
        command: "npx",
        args: ["-y", "@example/code-host-mcp"],
        env_vars: ["CODE_HOST_TOKEN"],
      },
      tracker: {
        url: "https://mcp.tracker.example.com/mcp",
        bearer_token_env_var: "TRACKER_TOKEN",
      },
      keyed: { url: "https://k.example.com/mcp", env_http_headers: { "X-Api-Key": "K_KEY" } },
    });
  });

  it("skips Cursor for remote servers with auth, naming host and server", () => {
    const { entries, skipped } = renderDirectEntries("cursor", [
      localServer,
      remoteBearer,
      remoteOpen,
    ]);
    expect(entries.map(([n]) => n)).toEqual(["code-host", "wiki"]);
    expect(skipped).toEqual([expect.objectContaining({ host: "cursor", server: "tracker" })]);
  });
});

let repoRoot: string;
beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-direct-"));
});
afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

async function writeCitadel(mcpServers: string): Promise<void> {
  await fs.writeFile(
    path.join(repoRoot, "citadel.yaml"),
    `schemaVersion: 1\nsources:\n  - name: docs\n    url: https://example.com/docs.git\n${mcpServers}`,
    "utf8",
  );
}

const ALL = ["claude-code", "cursor", "codex"] as const;
const readJson = async (rel: string) =>
  JSON.parse(await fs.readFile(path.join(repoRoot, rel), "utf8")) as {
    mcpServers: Record<string, Record<string, unknown>>;
  };
const readToml = async () =>
  TOML.parse(await fs.readFile(path.join(repoRoot, ".codex/config.toml"), "utf8")) as {
    mcp_servers: Record<string, Record<string, unknown>>;
  };

describe("refreshMcpRegistrations — direct servers", () => {
  const DIRECT = `mcpServers:
  - name: wiki
    kind: remote
    url: https://w.example.com/mcp
    register: direct
  - name: code-host
    kind: local
    command: npx
    envVars: [CODE_HOST_TOKEN]
    register: direct
`;

  it("writes managed entries to every host, is idempotent, and keeps their names out of maester's env", async () => {
    await writeCitadel(DIRECT);
    await refreshMcpRegistrations(repoRoot, { scopeTo: [...ALL] });
    const cc = await readJson(".mcp.json");
    expect(Object.keys(cc.mcpServers)).toEqual(["maester", "wiki", "code-host"]);
    expect(cc.mcpServers.maester?._maesterManagedServers).toEqual(["code-host", "wiki"]);
    expect(cc.mcpServers.maester?.env).toBeUndefined();
    expect((await readJson(".cursor/mcp.json")).mcpServers.wiki).toEqual({
      url: "https://w.example.com/mcp",
    });
    const codex = await readToml();
    expect(codex.mcp_servers["code-host"]).toEqual({
      command: "npx",
      args: [],
      env_vars: ["CODE_HOST_TOKEN"],
    });
    expect(codex.mcp_servers.maester?._maester_managed_servers).toEqual(["code-host", "wiki"]);

    const again = await refreshMcpRegistrations(repoRoot, { scopeTo: [...ALL] });
    expect(again.map((o) => o.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
  });

  it("removes managed entries when a server is switched to proxy or removed", async () => {
    await writeCitadel(DIRECT);
    await refreshMcpRegistrations(repoRoot, { scopeTo: [...ALL] });
    await writeCitadel(`mcpServers:
  - name: code-host
    kind: local
    command: npx
    envVars: [CODE_HOST_TOKEN]
`);
    await refreshMcpRegistrations(repoRoot, { scopeTo: [...ALL] });
    const cc = await readJson(".mcp.json");
    expect(Object.keys(cc.mcpServers)).toEqual(["maester"]);
    expect(cc.mcpServers.maester?._maesterManagedServers).toBeUndefined();
    // now proxied: its env var is forwarded to maester instead
    expect(cc.mcpServers.maester?.env).toEqual({ CODE_HOST_TOKEN: "${CODE_HOST_TOKEN:-}" });
    expect(Object.keys((await readToml()).mcp_servers)).toEqual(["maester"]);
  });

  it("never overwrites or removes an unmanaged entry with the same name", async () => {
    const userEntry = { command: "my-own-wiki" };
    await fs.writeFile(
      path.join(repoRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { wiki: userEntry, other: { command: "x" } } }),
    );
    await writeCitadel(DIRECT);
    const outcomes = await refreshMcpRegistrations(repoRoot, { scopeTo: ["claude-code"] });
    expect(outcomes[0]?.skipped).toEqual([
      expect.objectContaining({ host: "claude-code", server: "wiki" }),
    ]);
    let cc = await readJson(".mcp.json");
    expect(cc.mcpServers.wiki).toEqual(userEntry);
    expect(cc.mcpServers.maester?._maesterManagedServers).toEqual(["code-host"]);

    await writeCitadel("");
    await refreshMcpRegistrations(repoRoot, { scopeTo: ["claude-code"] });
    cc = await readJson(".mcp.json");
    expect(Object.keys(cc.mcpServers)).toEqual(["wiki", "other", "maester"]);
    expect(cc.mcpServers.wiki).toEqual(userEntry);
  });
});
