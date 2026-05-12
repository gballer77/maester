import { mkdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRepoRoot } from "../../../../src/core/repo/root.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("findRepoRoot", () => {
  it("returns the repo root when started from the root itself", () => {
    const root = findRepoRoot(repo.path);
    expect(root?.path).toBe(repo.path);
    expect(root?.hasGit).toBe(true);
    expect(root?.hasPackageJson).toBe(true);
  });

  it("walks upward to find the root from a nested directory", async () => {
    await mkdir(repo.resolve("a/b/c"), { recursive: true });
    const root = findRepoRoot(repo.resolve("a/b/c"));
    expect(root?.path).toBe(repo.path);
  });
});
