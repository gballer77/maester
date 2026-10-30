import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    const result = await runCli(["sync"], repo.path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("alpha");
    expect(existsSync(resolve(repo.path, "citadel/alpha/README.md"))).toBe(true);
  }, 30_000);

  it("renders manifest-driven and includes-driven sources together in human output", async () => {
    const manifestRemote = await createBareRemote({
      files: [
        { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
        { path: "README.md", contents: "# m\n" },
      ],
    });
    const includesRemote = await createBareRemote({
      files: [{ path: "README.md", contents: "# r\n" }],
    });
    remotes.push(manifestRemote, includesRemote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [
        { name: "alpha-m", url: toFileUrl(manifestRemote.bareRepoUrl), ref: "main" },
        {
          name: "beta-r",
          url: toFileUrl(includesRemote.bareRepoUrl),
          ref: "main",
          includes: ["README.md"],
        },
      ],
    });
    const result = await runCli(["sync"], repo.path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("alpha-m");
    expect(result.stdout).toContain("beta-r");
    expect(result.stdout).toMatch(/2 source\(s\) up to date/);
  }, 60_000);

  it("renders a no-matches warning beneath a drifted source", async () => {
    const remote = await createBareRemote({
      files: [{ path: "README.md", contents: "# only readme\n" }],
    });
    remotes.push(remote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [
        {
          name: "drifted",
          url: toFileUrl(remote.bareRepoUrl),
          ref: "main",
          includes: ["does/not/exist/*.md"],
        },
      ],
    });
    const result = await runCli(["sync"], repo.path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("drifted");
    expect(result.stdout + result.stderr).toMatch(/no files matched includes/i);
  }, 30_000);

  it("renders the whole-repository lines for a source without a manifest", async () => {
    const remote = await createBareRemote({
      files: [{ path: "README.md", contents: "# handbook\n" }],
    });
    remotes.push(remote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [{ name: "handbook", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
    });
    const result = await runCli(["sync"], repo.path);
    const output = result.stdout + result.stderr;
    expect(result.code).toBe(0);
    expect(output).toMatch(/handbook: added \([0-9a-f]{7}\) \(linked\)/);
    expect(output).toMatch(
      /whole repository \(1 file\(s\)\) — it has no includes and no maester\.yaml/,
    );
    expect(output).toContain("added /citadel/handbook/ to .gitignore");
  }, 30_000);

  it("labels path sources (linked) / (copied) and emits kind and sourcePath in --json", async () => {
    const notes = await makeTmpRepo({ withGit: false, withPackageJson: false });
    try {
      await notes.writeFile("README.md", "# notes\n");
      const rel = relative(repo.path, notes.path);
      await writeCitadelConfig(repo.path, {
        schemaVersion: 1,
        sources: [
          { name: "notes", path: rel, includes: ["README.md"] },
          {
            name: "handbook",
            path: rel,
            mode: "copy",
            includes: ["README.md"],
            destination: "vendor/handbook",
          },
        ],
      });
      const human = await runCli(["sync"], repo.path);
      expect(human.code).toBe(0);
      expect(human.stdout).toMatch(/notes: added \(linked\)/);
      expect(human.stdout).toMatch(/handbook: added \(copied\)/);
      expect(human.stdout).toContain("added /citadel/notes/ to .gitignore");

      const json = await runCli(["sync", "--json"], repo.path);
      const outcomes = json.stdout
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((o) => o.status !== undefined && o.event === undefined);
      expect(outcomes).toContainEqual(
        expect.objectContaining({ name: "notes", kind: "path", mode: "link", status: "unchanged" }),
      );
      expect(outcomes.find((o) => o.name === "handbook")?.sourcePath).toEqual(
        expect.stringMatching(/^\//),
      );
    } finally {
      await notes.cleanup();
    }
  }, 30_000);

  it("reports the category/tag breakdown, verbose sources of truth, and --json fields", async () => {
    const notes = await makeTmpRepo({ withGit: false, withPackageJson: false });
    try {
      await mkdir(notes.resolve("docs"), { recursive: true });
      await notes.writeFile("docs/a.md", "# a\n");
      await notes.writeFile("docs/b.md", "---\ncategory: runbook\n---\n# b\n");
      await notes.writeFile("README.md", "# readme\n");
      await writeCitadelConfig(repo.path, {
        schemaVersion: 1,
        sources: [
          {
            name: "handbook",
            path: relative(repo.path, notes.path),
            mode: "copy",
            includes: [{ path: "docs/**", category: "spec", tags: ["api", "public"] }, "README.md"],
          },
        ],
      });
      const human = await runCli(["--verbose", "sync"], repo.path);
      expect(human.code).toBe(0);
      expect(human.stdout).toContain(
        "categories: runbook 1 · spec 1 · unclassified 1 · tags: 2 distinct",
      );
      expect(human.stdout + human.stderr).toContain(
        "docs/b.md — state=draft (default) · category=runbook (inline) · tags=api,public (rule)",
      );
      expect(human.stdout + human.stderr).toContain(
        "docs/b.md: inline category 'runbook' overrides rule category 'spec'",
      );

      await notes.writeFile("README.md", "# readme v2\n");
      const json = await runCli(["--json", "sync"], repo.path);
      const outcome = json.stdout
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((o) => o.name === "handbook" && o.event === undefined);
      expect(outcome?.categoryBreakdown).toEqual({
        byCategory: { spec: 1, runbook: 1 },
        unclassified: 1,
      });
      expect(outcome?.tagRollup).toEqual({ byTag: { api: 2, public: 2 }, untagged: 1 });
      expect(outcome?.files).toBeUndefined();

      const quiet = await runCli(["--quiet", "sync"], repo.path);
      expect(quiet.stdout + quiet.stderr).not.toContain("overrides rule category");
    } finally {
      await notes.cleanup();
    }
  }, 30_000);

  it("lists the built-in excludes in sync --help", async () => {
    const result = await runCli(["sync", "--help"], repo.path);
    expect(result.stdout).toContain("Whole-repository sources:");
    expect(result.stdout).toContain("**/node_modules/**");
    expect(result.stdout).toContain("larger than 1024 KiB");
  }, 30_000);

  it("scopes a sync run to a single source name", async () => {
    const a = await createBareRemote({ files: [{ path: "a.md", contents: "a\n" }] });
    const b = await createBareRemote({ files: [{ path: "b.md", contents: "b\n" }] });
    remotes.push(a, b);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [
        {
          name: "alpha-m",
          url: toFileUrl(a.bareRepoUrl),
          ref: "main",
          includes: ["a.md"],
        },
        {
          name: "beta-r",
          url: toFileUrl(b.bareRepoUrl),
          ref: "main",
          includes: ["b.md"],
        },
      ],
    });
    const result = await runCli(["sync", "beta-r"], repo.path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("beta-r");
    expect(result.stdout).not.toContain("alpha-m");
  }, 30_000);

  it("exits non-zero and reports failure when a source has a bad ref", async () => {
    const remote = await createBareRemote({ files: [{ path: "README.md", contents: "ok\n" }] });
    remotes.push(remote);
    await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "no-such-branch" }],
    });
    const result = await runCli(["sync"], repo.path);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/alpha/);
    expect(result.stdout + result.stderr).toMatch(/fail/i);
  }, 30_000);

  it("emits one JSON object per outcome with --json", async () => {
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
      schemaVersion: 1,
      sources: [{ name: "alpha", url: toFileUrl(remote.bareRepoUrl), ref: "main" }],
    });
    const result = await runCli(["sync", "ghost"], repo.path);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Unknown source/i);
  }, 30_000);
});

function toFileUrl(path: string): string {
  return `file://${path}`;
}
