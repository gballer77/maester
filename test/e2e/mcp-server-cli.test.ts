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

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
  await repo.writeFile(
    "citadel.yaml",
    "schemaVersion: 1\nsources:\n  - name: docs\n    url: https://example.com/docs.git\n",
  );
  // Claude Code Grand Maester installed, so add/remove refresh `.mcp.json`.
  expect((await runCli(["skill", "install", "--target", "claude-code"], repo.path)).code).toBe(0);
});
afterEach(async () => {
  await repo.cleanup();
});

const readMcpJson = async () =>
  JSON.parse(await fs.readFile(repo.resolve(".mcp.json"), "utf8")) as {
    mcpServers: Record<string, Record<string, unknown>>;
  };

describe("CLI: maester mcp-server", () => {
  it("add → list → check → remove, writing env-var names only", async () => {
    const add = await runCli(
      [
        "mcp-server",
        "add",
        "--name",
        "code-host",
        "--kind",
        "local",
        "--command",
        process.execPath,
        "--args",
        `${STDIO_UPSTREAM} --tools search,get`,
        "--env-var",
        "CODE_HOST_TOKEN",
        "--yes",
      ],
      repo.path,
    );
    expect(add.code).toBe(0);
    expect(add.stdout + add.stderr).toMatch(/Restart your agent session/);
    expect(await fs.readFile(repo.resolve("citadel.yaml"), "utf8")).toMatch(
      /mcpServers:\n {2}- name: code-host/,
    );
    expect((await readMcpJson()).mcpServers.maester?.env).toEqual({
      CODE_HOST_TOKEN: "${CODE_HOST_TOKEN:-}",
    });

    const directAdd = await runCli(
      [
        "mcp-server",
        "add",
        "--name",
        "wiki",
        "--kind",
        "remote",
        "--url",
        "https://w.example.com/mcp",
        "--register",
        "direct",
        "--yes",
      ],
      repo.path,
    );
    expect(directAdd.code).toBe(0);
    expect((await readMcpJson()).mcpServers.wiki).toEqual({
      type: "http",
      url: "https://w.example.com/mcp",
    });

    const list = await runCli(["--json", "mcp-server", "list"], repo.path);
    expect(
      list.stdout
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l)),
    ).toEqual([
      { name: "code-host", kind: "local", mode: "proxy", envVars: ["CODE_HOST_TOKEN"] },
      { name: "wiki", kind: "remote", mode: "direct", envVars: [] },
    ]);

    const secret = "value-that-must-not-print";
    const ok = await runCli(["mcp-server", "check"], repo.path, { CODE_HOST_TOKEN: secret });
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("✓ code-host: 2 tools");
    expect(ok.stdout).toContain("code_host__search");
    expect(ok.stdout).toMatch(/wiki: host-managed/);
    expect(ok.stdout).toContain("Total tools exposed by maester: 2");
    expect(ok.stdout + ok.stderr).not.toContain(secret);

    const failed = await runCli(["mcp-server", "check", "code-host"], repo.path, {
      CODE_HOST_TOKEN: "",
    });
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain("✗ code-host: missing-env-var CODE_HOST_TOKEN");

    const remove = await runCli(["mcp-server", "remove", "wiki", "--yes"], repo.path);
    expect(remove.code).toBe(0);
    expect((await readMcpJson()).mcpServers.wiki).toBeUndefined();
  }, 60_000);

  it("rejects invalid flags and pasted secrets with exit 2, without echoing the value", async () => {
    const secret = "glpat-AbC123SecretValue";
    const result = await runCli(
      [
        "mcp-server",
        "add",
        "--name",
        "x",
        "--kind",
        "local",
        "--command",
        "x",
        "--env-var",
        secret,
        "--yes",
      ],
      repo.path,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/envVars\.0/);
    expect(result.stdout + result.stderr).not.toContain(secret);
    const dup = await runCli(
      ["mcp-server", "add", "--name", "maester", "--kind", "local", "--command", "x", "--yes"],
      repo.path,
    );
    expect(dup.code).toBe(2);
    expect(dup.stderr).toMatch(/reserved/);
  }, 60_000);

  it("check exits 2 for an unknown server name", async () => {
    const result = await runCli(["mcp-server", "check", "nope"], repo.path);
    expect(result.code).toBe(2);
  }, 30_000);
});
