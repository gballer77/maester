import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprintTree } from "../../../../src/core/sources/fingerprint.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo({ withGit: false, withPackageJson: false });
  await put("a.md", "alpha\n");
  await put("dir/b.md", "beta\n");
});
afterEach(async () => {
  await repo.cleanup();
});

async function put(rel: string, contents: string): Promise<void> {
  const path = resolve(repo.path, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

describe("fingerprintTree", () => {
  it("is stable and independent of input order", async () => {
    const a = await fingerprintTree(repo.path, ["a.md", "dir/b.md"], { content: true });
    const b = await fingerprintTree(repo.path, ["dir/b.md", "a.md"], { content: true });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes with content only when content hashing is on", async () => {
    const files = ["a.md", "dir/b.md"];
    const withContent = await fingerprintTree(repo.path, files, { content: true });
    const pathsOnly = await fingerprintTree(repo.path, files, { content: false });
    await put("a.md", "edited\n");
    expect(await fingerprintTree(repo.path, files, { content: true })).not.toBe(withContent);
    expect(await fingerprintTree(repo.path, files, { content: false })).toBe(pathsOnly);
  });

  it("changes when a file is added or removed, in either mode", async () => {
    for (const content of [true, false]) {
      const two = await fingerprintTree(repo.path, ["a.md", "dir/b.md"], { content });
      const one = await fingerprintTree(repo.path, ["a.md"], { content });
      expect(one).not.toBe(two);
    }
  });
});
