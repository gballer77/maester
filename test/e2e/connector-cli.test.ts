import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

const execFile = promisify(execFileCb);
const HERE = resolve(import.meta.dirname, "../..");
const BIN_PATH = resolve(HERE, "bin/maester.mjs");

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  try {
    const { stdout, stderr } = await execFile("node", [BIN_PATH, ...args], { cwd, env });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

async function writeCitadelYaml(repo: TempRepo, connectors?: string): Promise<void> {
  const yaml = `schemaVersion: 1
sources:
  - name: docs
    url: https://example.com/docs.git
${connectors ?? ""}`;
  await repo.writeFile("citadel.yaml", yaml);
}

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("CLI: maester connector", () => {
  it("list reports 'no connectors configured' on a fresh citadel", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["connector", "list"], repo.path);
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/No connectors configured/);
  });

  it("add --type rejects an unknown connector type with exit 2", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(
      ["connector", "add", "--type", "nope-no-such-type", "--name", "x"],
      repo.path,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Unknown connector type/);
  });

  it("add --type fails when --name is missing", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["connector", "add", "--type", "gitlab-issues"], repo.path);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/--name is required/);
  });

  it("remove --yes errors cleanly when the connector is not configured", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["connector", "remove", "ghost", "--yes"], repo.path);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/No connector named 'ghost'/);
  });

  it("exec errors cleanly when the connector is not configured", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(
      ["connector", "exec", "ghost", "echo", "--message", "hi"],
      repo.path,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/No connector named 'ghost'/);
  });

  it("commands outside a citadel-bearing directory exit with a clear error", async () => {
    const empty = await makeTmpRepo();
    try {
      const result = await runCli(["connector", "list"], empty.path);
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/citadel\.yaml/);
    } finally {
      await empty.cleanup();
    }
  });

  it("refresh succeeds on a citadel with zero connectors and no Grand Maester installed", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["connector", "refresh"], repo.path);
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/no connectors/i);
    expect(result.stdout + result.stderr).toMatch(/No MCP-capable Grand Maester targets installed/);
  });

  it("refresh outside a citadel-bearing directory exits 2 with a clear error", async () => {
    const empty = await makeTmpRepo();
    try {
      const result = await runCli(["connector", "refresh"], empty.path);
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/citadel\.yaml/);
    } finally {
      await empty.cleanup();
    }
  });

  it("refresh rejects a citadel that references an unregistered connector type", async () => {
    await writeCitadelYaml(
      repo,
      `connectors:
  - name: x
    type: __nonexistent_type__
    config: {}
`,
    );
    const result = await runCli(["connector", "refresh"], repo.path);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/unknown connector type/i);
  });

  it("list rejects a citadel that references an unregistered connector type", async () => {
    // Seed the citadel with a connectors entry whose type is not in the
    // production registry. The citadel validator rejects unknown types at
    // config-load time; the CLI surfaces the ConfigError on stderr and exits 2.
    await writeCitadelYaml(
      repo,
      `connectors:
  - name: x
    type: __nonexistent_type__
    config: {}
`,
    );
    const result = await runCli(["connector", "list"], repo.path);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/unknown connector type/i);
  });
});

// Keep fs/promises usage warm in case future tests need it for fixtures.
void fs;
