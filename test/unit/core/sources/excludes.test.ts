import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_EXCLUDES,
  BUILTIN_SPARSE_NEGATIONS,
  WHOLE_REPO_MAX_FILE_BYTES,
  effectiveExcludes,
  filterWholeRepoFiles,
} from "../../../../src/core/sources/excludes.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo({ withGit: false, withPackageJson: false });
});
afterEach(async () => {
  await repo.cleanup();
});

async function put(rel: string, contents: string | Buffer): Promise<void> {
  const path = repo.resolve(rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

describe("filterWholeRepoFiles", () => {
  it("keeps ordinary text files and returns them sorted", async () => {
    await put("README.md", "# hi\n");
    await put("docs/guide.md", "guide\n");
    const result = await filterWholeRepoFiles(
      repo.path,
      ["docs/guide.md", "README.md"],
      BUILTIN_EXCLUDES,
    );
    expect(result.files).toEqual(["README.md", "docs/guide.md"]);
    expect(result.skipped).toEqual({ excluded: 0, binary: 0, oversize: 0 });
  });

  it("skips built-in excluded directories at any depth", async () => {
    const files = [
      "node_modules/a/index.js",
      "packages/x/node_modules/b.js",
      "dist/out.js",
      ".maester/cache/x",
    ];
    for (const f of files) await put(f, "x");
    await put("README.md", "x");
    const result = await filterWholeRepoFiles(repo.path, [...files, "README.md"], BUILTIN_EXCLUDES);
    expect(result.files).toEqual(["README.md"]);
    expect(result.skipped.excluded).toBe(files.length);
  });

  it("applies the source's own excludes on top of the built-ins", async () => {
    await put("archive/old.md", "x");
    await put("diagram.drawio", "x");
    await put("keep.md", "x");
    const result = await filterWholeRepoFiles(
      repo.path,
      ["archive/old.md", "diagram.drawio", "keep.md"],
      effectiveExcludes(["archive/**", "**/*.drawio"]),
    );
    expect(result.files).toEqual(["keep.md"]);
  });

  it("skips binary files", async () => {
    await put("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const result = await filterWholeRepoFiles(repo.path, ["logo.png"], BUILTIN_EXCLUDES);
    expect(result.files).toEqual([]);
    expect(result.skipped.binary).toBe(1);
  });

  it("skips files larger than the size cap", async () => {
    await put("huge.md", "a".repeat(WHOLE_REPO_MAX_FILE_BYTES + 1));
    await put("edge.md", "a".repeat(WHOLE_REPO_MAX_FILE_BYTES));
    const result = await filterWholeRepoFiles(repo.path, ["huge.md", "edge.md"], BUILTIN_EXCLUDES);
    expect(result.files).toEqual(["edge.md"]);
    expect(result.skipped.oversize).toBe(1);
  });

  it("counts files that cannot be read as excluded", async () => {
    const result = await filterWholeRepoFiles(repo.path, ["missing.md"], BUILTIN_EXCLUDES);
    expect(result.files).toEqual([]);
    expect(result.skipped.excluded).toBe(1);
  });
});

describe("BUILTIN_SPARSE_NEGATIONS", () => {
  it("negates every excluded directory except .git", () => {
    expect(BUILTIN_SPARSE_NEGATIONS).toContain("!node_modules/");
    expect(BUILTIN_SPARSE_NEGATIONS).not.toContain("!.git/");
    expect(BUILTIN_SPARSE_NEGATIONS.every((p) => p.startsWith("!") && p.endsWith("/"))).toBe(true);
  });
});
