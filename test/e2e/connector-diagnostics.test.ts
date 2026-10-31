import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STDIO_UPSTREAM } from "../helpers/mcp-upstreams.js";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

const execFile = promisify(execFileCb);
const BIN_PATH = resolve(import.meta.dirname, "../../bin/maester.mjs");

async function runCli(args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...extraEnv };
  try {
    const { stdout, stderr } = await execFile("node", [BIN_PATH, ...args], { cwd, env });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

const SOURCES =
  "schemaVersion: 1\nsources:\n  - name: docs\n    url: https://example.com/docs.git\n";
const CONNECTOR = `connectors:
  - name: gitlab
    type: gitlab-issues
    auth:
      type: token
      envVar: SHARED_TOKEN
    config:
      project: g/p
`;
const proxied = (args: string) => `  - name: code-host
    kind: local
    command: ${JSON.stringify(process.execPath)}
    args: [${JSON.stringify(STDIO_UPSTREAM)}${args}]
    envVars: [SHARED_TOKEN]
`;
const DIRECT = `  - name: wiki
    kind: remote
    url: https://w.example.com/mcp
    register: direct
`;

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("CLI: maester connector refresh --dry-run", () => {
  it("prints each host's env set with contributors and writes nothing", async () => {
    await repo.writeFile("citadel.yaml", SOURCES);
    expect((await runCli(["skill", "install", "--target", "claude-code"], repo.path)).code).toBe(0);
    expect((await runCli(["skill", "install", "--target", "codex"], repo.path)).code).toBe(0);
    await repo.writeFile(
      "citadel.yaml",
      `${SOURCES}${CONNECTOR}mcpServers:\n${proxied("")}${DIRECT}`,
    );
    const before = await fs.readFile(repo.resolve(".mcp.json"), "utf8");

    const r = await runCli(["connector", "refresh", "--dry-run"], repo.path);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/claude-code → .*\.mcp\.json\n {2}would be rewritten/);
    expect(r.stdout).toMatch(/SHARED_TOKEN {2}\(connector:gitlab, mcp-server:code-host\)/);
    expect(r.stdout).toMatch(/codex → .*config\.toml/);
    expect(r.stdout).toMatch(/direct servers: wiki/);
    expect(r.stdout).toMatch(/Dry run — no files written/);
    expect(await fs.readFile(repo.resolve(".mcp.json"), "utf8")).toBe(before);

    const json = await runCli(["--json", "connector", "refresh", "--dry-run"], repo.path);
    expect(json.code).toBe(0);
    const lines = json.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.host)).toEqual(["claude-code", "codex"]);
    expect(lines[0]).toMatchObject({
      forwardedEnvVars: ["SHARED_TOKEN"],
      contributors: { SHARED_TOKEN: ["connector:gitlab", "mcp-server:code-host"] },
      directWritten: ["wiki"],
    });
  });

  it("says so when no MCP host is installed, and exits 2 on a config error", async () => {
    await repo.writeFile("citadel.yaml", SOURCES);
    const none = await runCli(["connector", "refresh", "--dry-run"], repo.path);
    expect(none.code).toBe(0);
    expect(none.stdout).toMatch(/No MCP-capable Grand Maester targets installed/);

    await repo.writeFile("citadel.yaml", "schemaVersion: 1\nsources: nope\n");
    expect((await runCli(["connector", "refresh", "--dry-run"], repo.path)).code).toBe(2);
  });
});

describe("CLI: maester connector tools", () => {
  it("lists connector tools, hints at proxied servers, and notes direct ones", async () => {
    await repo.writeFile(
      "citadel.yaml",
      `${SOURCES}${CONNECTOR}mcpServers:\n${proxied("")}${DIRECT}`,
    );
    const r = await runCli(["connector", "tools"], repo.path);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^gitlab__\w+\n {2}.+\n {2}args: /m);
    expect(r.stdout).toMatch(/code-host: proxied — pass --servers/);
    expect(r.stdout).toMatch(/wiki: host-managed \(register: direct\)/);
    expect(r.stdout).not.toMatch(/citadel__/);
  });

  it("--json returns a tools/list shape, adding linked-document tools when a link destination exists", async () => {
    await repo.writeFile("citadel.yaml", `${SOURCES}${CONNECTOR}`);
    await fs.mkdir(repo.resolve("citadel/docs"), { recursive: true });
    await repo.writeFile(
      "citadel/docs/.maester-source.json",
      JSON.stringify({
        markerVersion: 2,
        kind: "path",
        sourceName: "docs",
        sourcePath: "../docs",
        fingerprint: "sha256:x",
        mode: "link",
        filterSet: ["**"],
      }),
    );
    const r = await runCli(["--json", "connector", "tools"], repo.path);
    expect(r.code).toBe(0);
    const { tools } = JSON.parse(r.stdout) as {
      tools: { name: string; description: string; inputSchema: { type: string } }[];
    };
    expect(tools.every((t) => t.inputSchema.type === "object" && t.description)).toBe(true);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["citadel__list_linked_documents", "citadel__read_linked_document"]),
    );
  });

  it("--servers starts proxied servers and lists their tools; a failed server exits 1", async () => {
    await repo.writeFile(
      "citadel.yaml",
      `${SOURCES}mcpServers:\n${proxied(', "--tools", "search,get"')}`,
    );
    const ok = await runCli(["--json", "connector", "tools", "--servers"], repo.path, {
      SHARED_TOKEN: "t",
    });
    expect(ok.code).toBe(0);
    expect(
      (JSON.parse(ok.stdout) as { tools: { name: string }[] }).tools.map((t) => t.name),
    ).toEqual(["code_host__search", "code_host__get"]);

    await repo.writeFile(
      "citadel.yaml",
      `${SOURCES}mcpServers:\n  - name: broken\n    kind: local\n    command: definitely-not-a-command-xyz\n`,
    );
    const bad = await runCli(["connector", "tools", "--servers"], repo.path);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toMatch(/✗ broken: /);
  });
});
