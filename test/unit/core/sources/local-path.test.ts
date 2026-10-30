import { mkdir, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkPathOverlap,
  expandSourcePath,
  expandSourcePathLexically,
  isRelativeDeclaration,
  malformedPlaceholder,
} from "../../../../src/core/sources/local-path.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo({ withGit: false, withPackageJson: false });
});
afterEach(async () => {
  await repo.cleanup();
});

describe("malformedPlaceholder", () => {
  it("accepts well-formed placeholders and plain paths", () => {
    expect(malformedPlaceholder("${DOCS_HOME}/notes/${SUB}")).toBeUndefined();
    expect(malformedPlaceholder("../notes")).toBeUndefined();
  });

  it.each(["${lower}", "${DOCS", "${}", "${A-B}"])("flags %s", (raw) => {
    expect(malformedPlaceholder(raw)).toBeDefined();
  });
});

describe("isRelativeDeclaration", () => {
  it("is true only for plain relative paths", () => {
    expect(isRelativeDeclaration("../notes")).toBe(true);
    expect(isRelativeDeclaration("docs")).toBe(true);
    expect(isRelativeDeclaration("/abs")).toBe(false);
    expect(isRelativeDeclaration("~/notes")).toBe(false);
    expect(isRelativeDeclaration("${HOME}/notes")).toBe(false);
  });
});

describe("expandSourcePathLexically", () => {
  const ctx = { repoRoot: "/work/citadel", env: { DOCS: "/srv/docs" }, homedir: "/home/me" };

  it("expands placeholders, then ~, then resolves relative paths", () => {
    expect(expandSourcePathLexically("n", "${DOCS}/notes", ctx)).toBe("/srv/docs/notes");
    expect(expandSourcePathLexically("n", "~/notes", ctx)).toBe("/home/me/notes");
    expect(expandSourcePathLexically("n", "~", ctx)).toBe("/home/me");
    expect(expandSourcePathLexically("n", "../notes", ctx)).toBe("/work/notes");
    expect(expandSourcePathLexically("n", "/abs/x", ctx)).toBe("/abs/x");
  });

  it("fails naming the variable when it is unset or empty", () => {
    expect(() => expandSourcePathLexically("notes", "${MISSING}/x", ctx)).toThrow(
      /source 'notes' references \$\{MISSING\}, which is not set/,
    );
    expect(() =>
      expandSourcePathLexically("notes", "${EMPTY}", { ...ctx, env: { EMPTY: "" } }),
    ).toThrow(/EMPTY/);
  });
});

describe("expandSourcePath", () => {
  it("returns the realpath of an existing directory", async () => {
    await mkdir(repo.resolve("real/notes"), { recursive: true });
    await symlink(repo.resolve("real"), repo.resolve("alias"));
    const result = await expandSourcePath("notes", "alias/notes", {
      repoRoot: repo.path,
      env: {},
    });
    expect(result.absolute).toBe(repo.resolve("alias/notes"));
    expect(result.real.endsWith("/real/notes")).toBe(true);
  });

  it("fails when the path does not exist", async () => {
    await expect(
      expandSourcePath("notes", "nope", { repoRoot: repo.path, env: {} }),
    ).rejects.toMatchObject({ code: "SOURCE_PATH_MISSING" });
  });

  it("fails when the path is a file", async () => {
    await writeFile(repo.resolve("file.md"), "x", "utf8");
    await expect(
      expandSourcePath("notes", "file.md", { repoRoot: repo.path, env: {} }),
    ).rejects.toThrow(/is not a directory/);
  });
});

describe("checkPathOverlap", () => {
  const root = "/r";
  const targets = {
    baseDir: resolve(root, "citadel"),
    baseDirDisplay: "citadel",
    destinations: [
      { name: "api", path: resolve(root, "citadel/api"), display: "citadel/api" },
      { name: "vend", path: resolve(root, "vendor/x"), display: "vendor/x" },
    ],
  };

  it("allows a sibling directory and a non-output folder inside the repo", () => {
    expect(checkPathOverlap("n", "../notes", "/notes", targets)).toBeUndefined();
    expect(checkPathOverlap("n", "docs", "/r/docs", targets)).toBeUndefined();
  });

  it("rejects a source inside the base dir or a destination", () => {
    expect(checkPathOverlap("n", "citadel/q", "/r/citadel/q", targets)).toMatch(/base directory/);
    expect(checkPathOverlap("n", "vendor/x/d", "/r/vendor/x/d", targets)).toMatch(
      /overlaps destination vendor\/x\/ of source 'vend'/,
    );
  });

  it("rejects a source that contains the base dir or a destination", () => {
    expect(checkPathOverlap("n", ".", "/r", targets)).toMatch(/contains the citadel base/);
    expect(checkPathOverlap("n", "vendor", "/r/vendor", targets)).toMatch(
      /contains destination vendor\/x\//,
    );
  });

  it("does not confuse a name prefix with containment", () => {
    expect(checkPathOverlap("n", "citadel-notes", "/r/citadel-notes", targets)).toBeUndefined();
  });
});
