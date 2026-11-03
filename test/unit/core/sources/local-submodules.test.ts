import { execFile as execFileCb } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInventory } from "../../../../src/core/publisher/inventory.js";
import { runPreview } from "../../../../src/core/publisher/preview.js";
import { realOverlapTargets } from "../../../../src/core/sources/local-path.js";
import { fetchLocalSource } from "../../../../src/core/sources/local-source.js";
import type { PathSource } from "../../../../src/schemas/citadel.js";
import { type FixtureRemote, createBareRemote } from "../../../helpers/fixture-remote.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

const execFile = promisify(execFileCb);
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

// Layout: <tmp>/citadel-repo is the citadel; <tmp>/notes is a working tree
// with libs/a (initialized) and libs/b (declared but not initialized).
let tmp: TempRepo;
let remotes: FixtureRemote[];
let notes: string;

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFile("git", args, { cwd, env: GIT_ENV });
}

async function put(rel: string, contents: string): Promise<void> {
  const path = tmp.resolve(rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

beforeEach(async () => {
  tmp = await makeTmpRepo({ withGit: false, withPackageJson: false });
  await mkdir(tmp.resolve("citadel-repo"), { recursive: true });
  remotes = [
    await createBareRemote({ files: [{ path: "docs/a.md", contents: "# a\n" }] }),
    await createBareRemote({ files: [{ path: "docs/b.md", contents: "# b\n" }] }),
  ];
  notes = tmp.resolve("notes");
  await put("notes/README.md", "# notes\n");
  await git(tmp.path, "init", "--quiet", "--initial-branch=main", notes);
  for (const [i, path] of ["libs/a", "libs/b"].entries()) {
    const url = remotes[i]?.bareRepoUrl ?? "";
    await git(notes, "-c", "protocol.file.allow=always", "submodule", "add", "--quiet", url, path);
  }
  await git(notes, "add", "-A");
  await git(notes, "commit", "--quiet", "-m", "init");
  await git(notes, "submodule", "deinit", "--quiet", "-f", "libs/b");
});

afterEach(async () => {
  await tmp.cleanup();
  for (const r of remotes) await r.cleanup();
});

async function fetch(extra: Partial<PathSource>) {
  const repoRoot = tmp.resolve("citadel-repo");
  return fetchLocalSource({ name: "notes", path: "../notes", ...extra } as PathSource, {
    repoRoot,
    env: {},
    overlap: await realOverlapTargets(repoRoot, "citadel", [{ name: "notes" }]),
  });
}

describe("path sources with submodules", () => {
  it("surfaces initialized submodule files and warns about uninitialized ones", async () => {
    const tree = await fetch({ includes: ["README.md", "libs/*/docs/**"] });
    expect(tree.files).toEqual(["README.md", "libs/a/docs/a.md"]);
    expect(tree.warnings).toEqual([
      { type: "submodule-uninitialized", name: "notes", path: "libs/b" },
    ]);
  }, 30_000);

  it("never lists a submodule's .git file in whole-directory mode", async () => {
    const tree = await fetch({});
    expect(tree.files).toContain("libs/a/docs/a.md");
    expect(tree.files.some((f) => f.endsWith(".git"))).toBe(false);
  }, 30_000);

  it("drops submodule content with submodules: false", async () => {
    const tree = await fetch({ includes: ["README.md", "libs/**"], submodules: false });
    expect(tree.files).toEqual(["README.md"]);
    expect(tree.warnings).toEqual([
      { type: "submodules-disabled", name: "notes", paths: ["libs/a", "libs/b"] },
    ]);
  }, 30_000);
});

describe("publisher tooling with submodules", () => {
  it("inventory lists files inside initialized submodules and attributes them", async () => {
    const report = await runInventory(notes);
    const paths = report.files.map((f) => f.path);
    expect(paths).toContain("libs/a/docs/a.md");
    expect(paths).not.toContain("libs/a");
    expect(report.files.find((f) => f.path === "libs/a/docs/a.md")?.submodule).toBe("libs/a");
    expect(report.submodules).toEqual([
      { path: "libs/a", initialized: true },
      { path: "libs/b", initialized: false },
    ]);
  }, 30_000);

  it("preview resolves submodule paths and flags entries blocked by an uninitialized one", async () => {
    const report = await runPreview(notes, [
      { path: "libs/a/docs/**" },
      { path: "libs/b/docs/**" },
    ]);
    if (report.manifest !== "listed") throw new Error("expected a listed preview");
    expect(report.entries[0]?.files.map((f) => f.path)).toEqual(["libs/a/docs/a.md"]);
    expect(report.entries[0]?.flags).toEqual([]);
    expect(report.entries[1]?.flags).toEqual(["empty-entry", "uninitialized-submodule"]);
    expect(report.entries[1]?.submodules).toEqual(["libs/b"]);
  }, 30_000);
});
