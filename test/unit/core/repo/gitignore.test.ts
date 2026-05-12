import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendMissingGitignoreEntries } from "../../../../src/core/repo/gitignore.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo({ withGit: false });
});
afterEach(async () => {
  await repo.cleanup();
});

describe("appendMissingGitignoreEntries", () => {
  it("creates .gitignore with the new entries when none exists", async () => {
    const { added } = await appendMissingGitignoreEntries(repo.path, [".maester/"]);
    expect(added).toEqual([".maester/"]);
    const text = await readFile(repo.resolve(".gitignore"), "utf8");
    expect(text.trim()).toBe(".maester/");
  });

  it("preserves existing lines and appends missing ones", async () => {
    await writeFile(repo.resolve(".gitignore"), "node_modules\ndist\n", "utf8");
    const { added, alreadyPresent } = await appendMissingGitignoreEntries(repo.path, [
      "node_modules",
      ".maester/",
    ]);
    expect(added).toEqual([".maester/"]);
    expect(alreadyPresent).toEqual(["node_modules"]);
    const text = await readFile(repo.resolve(".gitignore"), "utf8");
    expect(text).toContain("node_modules\n");
    expect(text).toContain("dist\n");
    expect(text).toContain(".maester/\n");
  });

  it("never writes to disk when nothing is missing", async () => {
    const initial = ".maester/\nnode_modules\n";
    await writeFile(repo.resolve(".gitignore"), initial, "utf8");
    const { added } = await appendMissingGitignoreEntries(repo.path, [".maester/"]);
    expect(added).toEqual([]);
    const after = await readFile(repo.resolve(".gitignore"), "utf8");
    expect(after).toBe(initial);
  });

  it("adds a leading newline if the existing file is missing a trailing one", async () => {
    await writeFile(repo.resolve(".gitignore"), "node_modules", "utf8");
    await appendMissingGitignoreEntries(repo.path, [".maester/"]);
    const text = await readFile(repo.resolve(".gitignore"), "utf8");
    expect(text).toBe("node_modules\n.maester/\n");
  });
});
