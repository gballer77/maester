import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  compileFileMatcher,
  credentialForSubmodule,
  listGitlinks,
  localSubmodules,
  readGitmodules,
  rerootPatterns,
  resolveSubmoduleUrl,
  submoduleReached,
  syncSubmodules,
} from "../../../../src/core/sources/submodules.js";
import {
  type FixtureRemote,
  createBareRemote,
  createBareRemoteWithSubmodules,
} from "../../../helpers/fixture-remote.js";

const execFile = promisify(execFileCb);

describe("resolveSubmoduleUrl", () => {
  it.each([
    ["https://github.com/org/parent.git", "../sub.git", "https://github.com/org/sub.git"],
    ["https://github.com/org/parent.git/", "./sub", "https://github.com/org/parent.git/sub"],
    ["git@github.com:org/parent.git", "../sub.git", "git@github.com:org/sub.git"],
    ["ssh://git@host/a/b/parent", "../../c/sub", "ssh://git@host/a/c/sub"],
    ["/tmp/x/parent.git", "../sub.git", "/tmp/x/sub.git"],
    [
      "https://github.com/org/parent.git",
      "https://gitlab.com/o/s.git",
      "https://gitlab.com/o/s.git",
    ],
  ])("%s + %s → %s", (parent, url, expected) => {
    expect(resolveSubmoduleUrl(parent, url)).toBe(expected);
  });
});

describe("credentialForSubmodule", () => {
  it("reuses the token for an https submodule on the same host", () => {
    expect(
      credentialForSubmodule("https://github.com/o/p.git", "https://GitHub.com/o/s.git", "t"),
    ).toBe("t");
  });

  it("never sends the token to another host", () => {
    expect(
      credentialForSubmodule("https://github.com/o/p.git", "https://evil.example/o/s.git", "t"),
    ).toBeUndefined();
  });

  it("does not inject a token into non-https urls", () => {
    expect(
      credentialForSubmodule("https://github.com/o/p.git", "git@github.com:o/s.git", "t"),
    ).toBeUndefined();
  });
});

describe("submoduleReached / rerootPatterns", () => {
  it.each([
    [["services/billing/docs/**"], true],
    [["services/*/docs/**"], true],
    [["**/*.md"], true],
    [["services/billing"], true],
    [["docs/**"], false],
    [["*.md"], false],
    [["services/*"], false],
    [["services/auth/**"], false],
    [["!services/billing/**"], false],
  ])("%j reaches services/billing: %s", (patterns, expected) => {
    expect(submoduleReached("services/billing", patterns)).toBe(expected);
  });

  it("re-roots patterns that lie under the submodule", () => {
    expect(rerootPatterns("services/billing", ["docs/**", "services/*/docs/**/*.md"])).toEqual([
      "/docs/**/*.md",
    ]);
  });

  it("falls back to a full checkout when a pattern crosses ** above the submodule", () => {
    expect(rerootPatterns("services/billing", ["**/*.md"])[0]).toBe("/*");
  });

  it("matches literal directories like manifest resolution does", () => {
    const match = compileFileMatcher(["services/billing", "docs/*.md"]);
    expect(match("services/billing/a/b.md")).toBe(true);
    expect(match("docs/x.md")).toBe(true);
    expect(match("docs/a/x.md")).toBe(false);
  });
});

describe("git-backed helpers", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0)) await fn();
  });

  async function remote(files: { path: string; contents: string }[]): Promise<FixtureRemote> {
    const r = await createBareRemote({ files });
    cleanup.push(() => r.cleanup());
    return r;
  }

  async function cloneOf(r: FixtureRemote): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "maester-sub-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    await execFile("git", ["clone", "--quiet", r.bareRepoUrl, dir]);
    return dir;
  }

  it("lists gitlinks and reads .gitmodules from a commit", async () => {
    const sub = await remote([{ path: "a.md", contents: "a\n" }]);
    const umbrella = await createBareRemoteWithSubmodules({
      files: [{ path: "README.md", contents: "r\n" }],
      submodules: [{ path: "libs/sub", remote: sub }],
    });
    cleanup.push(() => umbrella.cleanup());
    const dir = await cloneOf(umbrella);

    const links = await listGitlinks(dir);
    expect(links.map((l) => l.path)).toEqual(["libs/sub"]);
    expect(links[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await readGitmodules(dir)).get("libs/sub")).toBe(sub.bareRepoUrl);
  }, 30_000);

  it("materializes reached submodules recursively and prunes them when no longer reached", async () => {
    const leaf = await remote([{ path: "docs/leaf.md", contents: "leaf\n" }]);
    const mid = await createBareRemoteWithSubmodules({
      files: [
        { path: "docs/mid.md", contents: "mid\n" },
        { path: "src/x.ts", contents: "x\n" },
      ],
      submodules: [{ path: "deps/leaf", remote: leaf }],
    });
    cleanup.push(() => mid.cleanup());
    const umbrella = await createBareRemoteWithSubmodules({
      files: [{ path: "README.md", contents: "r\n" }],
      submodules: [{ path: "mid", remote: mid }],
    });
    cleanup.push(() => umbrella.cleanup());
    const dir = await cloneOf(umbrella);

    const first = await syncSubmodules({
      name: "u",
      root: dir,
      sourceUrl: umbrella.bareRepoUrl,
      token: undefined,
      filter: { kind: "patterns", patterns: ["mid/docs/**", "mid/deps/leaf/docs/**"] },
    });
    expect(first.warnings).toEqual([]);
    expect(first.submodules.map((s) => s.path)).toEqual(["mid", "mid/deps/leaf"]);
    expect(existsSync(resolve(dir, "mid/docs/mid.md"))).toBe(true);
    expect(existsSync(resolve(dir, "mid/src/x.ts"))).toBe(false);
    expect(existsSync(resolve(dir, "mid/deps/leaf/docs/leaf.md"))).toBe(true);

    const second = await syncSubmodules({
      name: "u",
      root: dir,
      sourceUrl: umbrella.bareRepoUrl,
      token: undefined,
      filter: { kind: "patterns", patterns: ["README.md"] },
    });
    expect(second.submodules).toEqual([]);
    expect(existsSync(resolve(dir, "mid/docs/mid.md"))).toBe(false);
  }, 60_000);

  it("turns an unreachable submodule into a warning", async () => {
    const sub = await remote([{ path: "a.md", contents: "a\n" }]);
    const umbrella = await createBareRemoteWithSubmodules({
      files: [{ path: "README.md", contents: "r\n" }],
      submodules: [{ path: "gone", remote: sub }],
    });
    cleanup.push(() => umbrella.cleanup());
    const dir = await cloneOf(umbrella);
    await sub.cleanup();

    const result = await syncSubmodules({
      name: "u",
      root: dir,
      sourceUrl: umbrella.bareRepoUrl,
      token: undefined,
      filter: { kind: "all", excludes: [] },
    });
    expect(result.submodules).toEqual([]);
    expect(result.warnings).toMatchObject([
      { type: "submodule-unreachable", name: "u", path: "gone" },
    ]);
  }, 30_000);

  it("skips submodules under excluded directories in whole-repository mode", async () => {
    const sub = await remote([{ path: "a.md", contents: "a\n" }]);
    const umbrella = await createBareRemoteWithSubmodules({
      files: [{ path: "README.md", contents: "r\n" }],
      submodules: [{ path: "vendor/lib", remote: sub }],
    });
    cleanup.push(() => umbrella.cleanup());
    const dir = await cloneOf(umbrella);
    const result = await syncSubmodules({
      name: "u",
      root: dir,
      sourceUrl: umbrella.bareRepoUrl,
      token: undefined,
      filter: { kind: "all", excludes: ["**/vendor/**"] },
    });
    expect(result.submodules).toEqual([]);
  }, 30_000);

  it("reports local submodules and whether they are initialized", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maester-local-sub-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    await writeFile(
      resolve(dir, ".gitmodules"),
      '[submodule "a"]\n\tpath = a\n\turl = ../a\n[submodule "b"]\n\tpath = b\n\turl = ../b\n',
    );
    await mkdir(resolve(dir, "a/.git"), { recursive: true });
    await mkdir(resolve(dir, "b"), { recursive: true });
    expect(await localSubmodules(dir)).toEqual([
      { path: "a", initialized: true },
      { path: "b", initialized: false },
    ]);
  });
});
