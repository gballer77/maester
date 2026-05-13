import { execFile as execFileCb } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { writeCitadelConfig } from "../../src/core/config/writer.js";
import { runSync } from "../../src/core/sync/runner.js";
import type { CitadelConfig } from "../../src/schemas/citadel.js";
import { type FixtureRemote, createBareRemote } from "../helpers/fixture-remote.js";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

const execFile = promisify(execFileCb);
const REPO_ROOT = resolve(__dirname, "..", "..");
const BIN_PATH = resolve(REPO_ROOT, "bin/maester.mjs");

async function runCli(
  args: string[],
  cwd: string,
  envOverrides: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...envOverrides };
  try {
    const { stdout, stderr } = await execFile("node", [BIN_PATH, ...args], { cwd, env });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

async function pushNewCommit(
  remote: FixtureRemote,
  files: { path: string; contents: string }[],
): Promise<void> {
  const tmp = await makeTmpRepo({ withGit: false, withPackageJson: false });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  await execFile("git", ["clone", "--quiet", toFileUrl(remote.bareRepoUrl), tmp.path], { env });
  for (const file of files) {
    await tmp.writeFile(file.path, file.contents);
  }
  await execFile("git", ["-C", tmp.path, "add", "-A"], { env });
  await execFile("git", ["-C", tmp.path, "commit", "-m", "advance", "--quiet"], { env });
  await execFile("git", ["-C", tmp.path, "push", "--quiet"], { env });
  await tmp.cleanup();
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

afterAll(() => {
  /* no-op; remotes/repo are torn down per-test */
});

describe("CLI: maester status", () => {
  it("exits 2 when run outside a citadel (no citadel.yaml)", async () => {
    const result = await runCli(["status"], repo.path);
    expect(result.code).toBe(2);
    expect((result.stderr + result.stdout).toLowerCase()).toMatch(/citadel|config/);
  }, 30_000);

  it("exits 1 with every source reported as never-synced on a fresh citadel", async () => {
    const remote = await createBareRemote({
      files: [
        { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
        { path: "README.md", contents: "ok\n" },
      ],
    });
    remotes.push(remote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
    });
    const result = await runCli(["status"], repo.path);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("alpha");
    expect(result.stdout).toContain("never synced");
  }, 30_000);

  it("exits 0 when every source is up to date after a sync", async () => {
    const remote = await createBareRemote({
      files: [
        { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
        { path: "README.md", contents: "ok\n" },
      ],
    });
    remotes.push(remote);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
    };
    await writeCitadelConfig(repo.path, config);
    await runSync(config, { repoRoot: repo.path });

    const result = await runCli(["status"], repo.path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("up to date");
  }, 60_000);

  it("exits 1 with remote-ref-advanced when a new commit lands upstream", async () => {
    const remote = await createBareRemote({
      files: [
        { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
        { path: "README.md", contents: "ok\n" },
      ],
    });
    remotes.push(remote);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
    };
    await writeCitadelConfig(repo.path, config);
    await runSync(config, { repoRoot: repo.path });
    await pushNewCommit(remote, [{ path: "README.md", contents: "ok v2\n" }]);

    const result = await runCli(["status"], repo.path);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("remote ref advanced");
  }, 60_000);

  it("emits NDJSON in --json mode with a final summary line", async () => {
    const remote = await createBareRemote({
      files: [
        { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
        { path: "README.md", contents: "ok\n" },
      ],
    });
    remotes.push(remote);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
    };
    await writeCitadelConfig(repo.path, config);
    await runSync(config, { repoRoot: repo.path });

    const result = await runCli(["--json", "status"], repo.path);
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBe(2);
    const outcome = JSON.parse(lines[0] ?? "{}");
    const summary = JSON.parse(lines[1] ?? "{}");
    expect(outcome).toMatchObject({ name: "alpha", verdict: "up-to-date" });
    expect(outcome.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(summary).toMatchObject({ type: "summary", upToDate: 1, behind: 0, failed: 0 });
  }, 60_000);

  it("scopes to a named source and exits 2 for an unknown scope name", async () => {
    const remote = await createBareRemote({
      files: [
        { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
        { path: "README.md", contents: "ok\n" },
      ],
    });
    remotes.push(remote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
    });

    const known = await runCli(["status", "alpha"], repo.path);
    expect(known.code).toBe(1); // never synced
    expect(known.stdout).toContain("alpha");

    const unknown = await runCli(["status", "nope"], repo.path);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr + unknown.stdout).toMatch(/Unknown source 'nope'/);
  }, 30_000);

  it("exits 2 (failure precedence) when an auth env-var is missing, even alongside up-to-date sources", async () => {
    const remote = await createBareRemote({
      files: [
        { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
        { path: "README.md", contents: "ok\n" },
      ],
    });
    remotes.push(remote);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        { name: "good", url: toFileUrl(remote.bareRepoUrl), ref: "main" },
        {
          name: "bad",
          url: toFileUrl(remote.bareRepoUrl),
          ref: "main",
          auth: { type: "token", envVar: "MAESTER_CLI_NOPE_TOKEN" },
        },
      ],
    };
    await writeCitadelConfig(repo.path, config);
    await runSync(config, { repoRoot: repo.path, env: { MAESTER_CLI_NOPE_TOKEN: "x" } });

    const result = await runCli(["status"], repo.path, { MAESTER_CLI_NOPE_TOKEN: undefined });
    expect(result.code).toBe(2);
    // Up-to-date sources land on stdout; failures land on stderr via the logger.
    expect(result.stdout).toContain("up to date");
    expect(result.stderr).toContain("failed");
    expect(result.stderr).toContain("MAESTER_CLI_NOPE_TOKEN");
  }, 60_000);
});

function toFileUrl(path: string): string {
  return `file://${path}`;
}
