import { execFile as execFileCb } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

const execFile = promisify(execFileCb);
const BIN_PATH = resolve(import.meta.dirname, "../../bin/maester.mjs");

async function runCli(args: string[], cwd: string) {
  try {
    const { stdout, stderr } = await execFile("node", [BIN_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("CLI: config-editing verbs", () => {
  it("list prints the sources, count and file path; exits 2 without a config", async () => {
    expect((await runCli(["list"], repo.path)).code).toBe(2);
    expect((await runCli(["publish", "list"], repo.path)).code).toBe(2);
    await repo.writeFile(
      "citadel.yaml",
      "schemaVersion: 1\nsources:\n  - name: docs\n    url: https://example.com/docs.git\n",
    );
    const list = await runCli(["list"], repo.path);
    expect(list.code).toBe(0);
    expect(list.stdout).toMatch(/docs .*https:\/\/example.com\/docs.git .*default branch/);
    expect(list.stdout).toMatch(/1 source in \/.*\/citadel\.yaml/);
  }, 30_000);

  it("`maester publish` keeps its walkthrough and points to the edit verbs when configured", async () => {
    await repo.writeFile("maester.yaml", "schemaVersion: 1\ndocuments:\n  - path: README.md\n");
    const bare = await runCli(["publish"], repo.path);
    expect(bare.stdout + bare.stderr).toMatch(/maester publish add/);
    const list = await runCli(["publish", "list"], repo.path);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("README.md");
  }, 30_000);
});
