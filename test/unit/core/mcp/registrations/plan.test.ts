import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  planMcpRegistrations,
  refreshMcpRegistrations,
} from "../../../../../src/core/mcp/registrations/index.js";

let repoRoot: string;
beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-plan-"));
});
afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const ALL = ["claude-code", "cursor", "codex"] as const;

const CONNECTOR = `connectors:
  - name: gitlab
    type: gitlab-issues
    auth:
      type: token
      envVar: SHARED_TOKEN
    config:
      project: g/p
`;
const SERVERS = `mcpServers:
  - name: code-host
    kind: local
    command: npx
    envVars: [SHARED_TOKEN, CODE_HOST_TOKEN]
  - name: wiki
    kind: remote
    url: https://w.example.com/mcp
    register: direct
`;

async function writeCitadel(body: string): Promise<void> {
  await fs.writeFile(
    path.join(repoRoot, "citadel.yaml"),
    `schemaVersion: 1\nsources:\n  - name: docs\n    url: https://example.com/docs.git\n${body}`,
    "utf8",
  );
}

async function snapshot(): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const rel of [".mcp.json", ".cursor/mcp.json", ".codex/config.toml"]) {
    out[rel] = await fs.readFile(path.join(repoRoot, rel), "utf8").catch(() => undefined);
  }
  return out;
}

describe("planMcpRegistrations", () => {
  it("reports forwarded names with contributors and direct entries, writing nothing", async () => {
    await writeCitadel(CONNECTOR + SERVERS);
    const { inputs, hosts } = await planMcpRegistrations(repoRoot, { scopeTo: [...ALL] });
    expect(await snapshot()).toEqual({
      ".mcp.json": undefined,
      ".cursor/mcp.json": undefined,
      ".codex/config.toml": undefined,
    });
    expect(inputs.contributors).toEqual({
      CODE_HOST_TOKEN: ["mcp-server:code-host"],
      SHARED_TOKEN: ["connector:gitlab", "mcp-server:code-host"],
    });
    const byHost = Object.fromEntries(hosts.map((h) => [h.host, h]));
    expect(byHost["claude-code"]).toMatchObject({
      wouldChange: true,
      forwardedEnvVars: ["CODE_HOST_TOKEN", "SHARED_TOKEN"],
      userEnvVars: [],
      directWritten: ["wiki"],
      directRemoved: [],
    });
    expect(byHost.codex?.forwardedEnvVars).toEqual(["CODE_HOST_TOKEN", "SHARED_TOKEN"]);
    expect(byHost.cursor).toMatchObject({ forwardedEnvVars: [], directWritten: ["wiki"] });
  });

  it("agrees with a real refresh, then reports up to date", async () => {
    await writeCitadel(CONNECTOR + SERVERS);
    const plan = await planMcpRegistrations(repoRoot, { scopeTo: [...ALL] });
    const outcomes = await refreshMcpRegistrations(repoRoot, { scopeTo: [...ALL] });
    expect(outcomes.map((o) => o.action)).toEqual(plan.hosts.map(() => "written"));
    const after = await planMcpRegistrations(repoRoot, { scopeTo: [...ALL] });
    expect(after.hosts.map((h) => h.wouldChange)).toEqual([false, false, false]);
    expect(after.hosts.map((h) => h.directWritten)).toEqual(plan.hosts.map((h) => h.directWritten));
  });

  it("keeps hand-added env names and reports direct servers a refresh would remove", async () => {
    await writeCitadel(CONNECTOR + SERVERS);
    await refreshMcpRegistrations(repoRoot, { scopeTo: ["claude-code"] });
    const file = path.join(repoRoot, ".mcp.json");
    const json = JSON.parse(await fs.readFile(file, "utf8"));
    json.mcpServers.maester.env.MY_OWN = "x";
    await fs.writeFile(file, JSON.stringify(json, null, 2));
    await writeCitadel(CONNECTOR);
    const before = await snapshot();

    const { hosts } = await planMcpRegistrations(repoRoot, { scopeTo: ["claude-code"] });
    expect(hosts).toEqual([
      expect.objectContaining({
        host: "claude-code",
        wouldChange: true,
        forwardedEnvVars: ["SHARED_TOKEN"],
        userEnvVars: ["MY_OWN"],
        directWritten: [],
        directRemoved: ["wiki"],
      }),
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it("skips hosts whose Grand Maester is not installed", async () => {
    await writeCitadel(CONNECTOR);
    expect((await planMcpRegistrations(repoRoot)).hosts).toEqual([]);
  });

  it("reports a host file it cannot parse as an error", async () => {
    await writeCitadel(CONNECTOR);
    await fs.writeFile(path.join(repoRoot, ".mcp.json"), "{ not json");
    const { hosts } = await planMcpRegistrations(repoRoot, { scopeTo: ["claude-code"] });
    expect(hosts[0]?.error).toMatch(/JSON/);
  });
});
