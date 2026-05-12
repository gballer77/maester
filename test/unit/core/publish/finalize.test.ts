import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMaesterConfig } from "../../../../src/core/config/loader.js";
import {
  detectDuplicatePaths,
  finalizeMaesterManifest,
} from "../../../../src/core/publish/finalize.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("finalizeMaesterManifest", () => {
  it("writes maester.yaml with header and round-trips through the loader", async () => {
    await finalizeMaesterManifest(repo.path, [
      { path: "README.md", category: "readme" },
      { path: "docs/adr/*.md", tags: ["architecture"] },
    ]);
    const text = await readFile(repo.resolve("maester.yaml"), "utf8");
    expect(text).toContain("# maester.yaml");
    const config = await loadMaesterConfig(repo.path);
    expect(config.documents).toHaveLength(2);
  });

  it("never touches citadel.yaml", async () => {
    await finalizeMaesterManifest(repo.path, [{ path: "README.md" }]);
    let caught: unknown;
    try {
      await readFile(repo.resolve("citadel.yaml"), "utf8");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
  });
});

describe("detectDuplicatePaths", () => {
  it("throws on duplicate paths", () => {
    expect(() => detectDuplicatePaths([{ path: "README.md" }, { path: "README.md" }])).toThrow(
      /Duplicate/,
    );
  });

  it("does not throw on unique paths", () => {
    expect(() =>
      detectDuplicatePaths([{ path: "README.md" }, { path: "docs/*.md" }]),
    ).not.toThrow();
  });
});
