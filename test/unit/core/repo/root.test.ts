import { mkdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRepoRoot } from "../../../../src/core/repo/root.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("getRepoRoot", () => {
  it("returns the given directory as the root (does not walk upward)", () => {
    const root = getRepoRoot(repo.path);
    expect(root.path).toBe(repo.path);
    expect(root.hasGit).toBe(true);
    expect(root.hasPackageJson).toBe(true);
  });

  it("returns a nested directory as the root even when an ancestor has .git", async () => {
    await mkdir(repo.resolve("a/b/c"), { recursive: true });
    const root = getRepoRoot(repo.resolve("a/b/c"));
    expect(root.path).toBe(repo.resolve("a/b/c"));
    expect(root.hasGit).toBe(false);
    expect(root.hasPackageJson).toBe(false);
  });
});
