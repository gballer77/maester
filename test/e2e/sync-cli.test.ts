import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { writeCitadelConfig } from "../../src/core/config/writer.js";
import { type FixtureRemote, createBareRemote } from "../helpers/fixture-remote.js";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

const execFile = promisify(execFileCb);
const REPO_ROOT = resolve(__dirname, "..", "..");
const BIN_PATH = resolve(REPO_ROOT, "bin/maester.mjs");

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
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
let remotes: FixtureRemote[] = [];

beforeAll(async () => {
  await execFile("pnpm", ["run", "build"], { cwd: REPO_ROOT });
}, 90_000);

beforeEach(async () => {
  repo = await makeTmpRepo();
  remotes = [];
});

afterEach(async () => {
  await repo.cleanup();
  for (const r of remotes) await r.cleanup();
});

describe("CLI: maester sync", () => {
  it("syncs configured sources and exits 0", async () => {
    const remote = await createBareRemote({ files: [{ path: "README.md", contents: "ok\n" }] });
    remotes.push(remote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 2,
      maesters: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
      ravens: [],
    });
    const result = await runCli(["sync"], repo.path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("alpha");
    expect(existsSync(resolve(repo.path, "citadel/alpha/README.md"))).toBe(true);
  }, 30_000);

  it("exits non-zero and reports failure when a source has a bad ref", async () => {
    const remote = await createBareRemote({ files: [{ path: "README.md", contents: "ok\n" }] });
    remotes.push(remote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 2,
      maesters: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "no-such-branch" }],
      ravens: [],
    });
    const result = await runCli(["sync"], repo.path);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/alpha/);
    expect(result.stdout + result.stderr).toMatch(/fail/i);
  }, 30_000);

  it("emits one JSON object per outcome with --json", async () => {
    const remote = await createBareRemote({ files: [{ path: "README.md", contents: "ok\n" }] });
    remotes.push(remote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 2,
      maesters: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
      ravens: [],
    });
    const result = await runCli(["--json", "sync"], repo.path);
    expect(result.code).toBe(0);
    const lines = result.stdout.split("\n").filter((l) => l.trim().length > 0);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const outcome = parsed.find((p) => p.name === "alpha" && p.status === "added");
    expect(outcome?.name).toBe("alpha");
    for (const obj of parsed) {
      expect(typeof obj).toBe("object");
    }
  }, 30_000);

  it("rejects unknown source names in scope", async () => {
    const remote = await createBareRemote({ files: [{ path: "README.md", contents: "ok\n" }] });
    remotes.push(remote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 2,
      maesters: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
      ravens: [],
    });
    const result = await runCli(["sync", "ghost"], repo.path);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Unknown source/i);
  }, 30_000);
});

function toFileUrl(path: string): string {
  return `file://${path}`;
}
