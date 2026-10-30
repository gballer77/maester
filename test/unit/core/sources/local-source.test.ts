import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realOverlapTargets } from "../../../../src/core/sources/local-path.js";
import { fetchLocalSource } from "../../../../src/core/sources/local-source.js";
import type { PathSource } from "../../../../src/schemas/citadel.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

// Layout: <tmp>/citadel-repo is the citadel; <tmp>/notes is the source.
let tmp: TempRepo;
let repoRoot: string;

beforeEach(async () => {
  tmp = await makeTmpRepo({ withGit: false, withPackageJson: false });
  repoRoot = tmp.resolve("citadel-repo");
  await mkdir(repoRoot, { recursive: true });
  await put("notes/README.md", "# notes\n");
  await put("notes/guides/setup.md", "setup\n");
  await put("notes/node_modules/x/index.js", "x\n");
});
afterEach(async () => {
  await tmp.cleanup();
});

async function put(rel: string, contents: string): Promise<void> {
  const path = tmp.resolve(rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function ctx(env: NodeJS.ProcessEnv = {}) {
  return {
    repoRoot,
    env,
    overlap: await realOverlapTargets(repoRoot, "citadel", [{ name: "notes" }]),
  };
}

function source(extra: Partial<PathSource> = {}): PathSource {
  return { name: "notes", path: "../notes", ...extra } as PathSource;
}

describe("fetchLocalSource", () => {
  it("surfaces the whole directory, minus built-in excludes, when there is no manifest", async () => {
    const tree = await fetchLocalSource(source(), await ctx());
    expect(tree).toMatchObject({
      kind: "path",
      filterMode: "whole-repository",
      wholeRepoReason: "no-manifest",
      mode: "link",
      relativeLinks: true,
      filterSet: ["**"],
    });
    expect(tree.files).toEqual(["README.md", "guides/setup.md"]);
  });

  it("drops symlinked files and honours source excludes in whole-directory mode", async () => {
    await put("outside.md", "secret\n");
    await symlink(tmp.resolve("outside.md"), tmp.resolve("notes/escape.md"));
    await put("notes/archive/old.md", "old\n");
    const tree = await fetchLocalSource(source({ excludes: ["archive/**"] }), await ctx());
    expect(tree.files).toEqual(["README.md", "guides/setup.md"]);
  });

  it("uses a manifest's published set (plus maester.yaml) when present", async () => {
    await put("notes/maester.yaml", "schemaVersion: 1\ndocuments:\n  - path: guides/*.md\n");
    const tree = await fetchLocalSource(source(), await ctx());
    expect(tree.filterMode).toBe("manifest");
    expect(tree.files).toEqual(["guides/setup.md", "maester.yaml"]);
  });

  it("treats an empty manifest as whole-repository", async () => {
    await put("notes/maester.yaml", "schemaVersion: 1\ndocuments: []\n");
    const tree = await fetchLocalSource(source(), await ctx());
    expect(tree.wholeRepoReason).toBe("empty-manifest");
  });

  it("fails on an invalid manifest", async () => {
    await put("notes/maester.yaml", "schemaVersion: 99\n");
    await expect(fetchLocalSource(source(), await ctx())).rejects.toMatchObject({
      code: "MAESTER_MANIFEST_INVALID",
    });
  });

  it("makes includes authoritative and ignores the manifest", async () => {
    await put("notes/maester.yaml", "schemaVersion: 1\ndocuments:\n  - path: guides/*.md\n");
    const tree = await fetchLocalSource(source({ includes: ["README.md"] }), await ctx());
    expect(tree.filterMode).toBe("includes");
    expect(tree.files).toEqual(["README.md"]);
  });

  it("warns, not fails, when includes match nothing", async () => {
    const tree = await fetchLocalSource(source({ includes: ["nope/*.md"] }), await ctx());
    expect(tree.files).toEqual([]);
    expect(tree.warnings).toContainEqual({
      type: "no-matches",
      name: "notes",
      includes: ["nope/*.md"],
    });
  });

  it("fails copy mode that would surface the whole directory", async () => {
    await expect(fetchLocalSource(source({ mode: "copy" }), await ctx())).rejects.toMatchObject({
      code: "COPY_REQUIRES_DECLARED_PATHS",
    });
  });

  it("fingerprints content only in copy mode", async () => {
    const copy = source({ includes: ["README.md"], mode: "copy" });
    const link = source({ includes: ["README.md"] });
    const copyBefore = (await fetchLocalSource(copy, await ctx())).fingerprint;
    const linkBefore = (await fetchLocalSource(link, await ctx())).fingerprint;
    await put("notes/README.md", "# edited\n");
    expect((await fetchLocalSource(copy, await ctx())).fingerprint).not.toBe(copyBefore);
    expect((await fetchLocalSource(link, await ctx())).fingerprint).toBe(linkBefore);
  });

  it("uses absolute link targets for ${VAR} paths and fails when the variable is unset", async () => {
    const env = source({ path: "${NOTES_HOME}" });
    const tree = await fetchLocalSource(env, await ctx({ NOTES_HOME: tmp.resolve("notes") }));
    expect(tree.relativeLinks).toBe(false);
    await expect(fetchLocalSource(env, await ctx())).rejects.toMatchObject({
      code: "SOURCE_PATH_ENV_UNSET",
    });
  });

  it("fails when the directory is missing", async () => {
    await expect(fetchLocalSource(source({ path: "../gone" }), await ctx())).rejects.toMatchObject({
      code: "SOURCE_PATH_MISSING",
    });
  });

  it("re-checks overlap at run time after expanding variables", async () => {
    await mkdir(resolve(repoRoot, "citadel/notes"), { recursive: true });
    const inside = source({ path: "${OUT}" });
    await expect(
      fetchLocalSource(inside, await ctx({ OUT: resolve(repoRoot, "citadel/notes") })),
    ).rejects.toMatchObject({ code: "SOURCE_PATH_OVERLAP" });
  });
});
