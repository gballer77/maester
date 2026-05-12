import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCitadelConfig } from "../../../../src/core/config/loader.js";
import {
  detectDestinationCollisions,
  finalizeCitadel,
} from "../../../../src/core/init/finalize.js";
import { ensureScript } from "../../../../src/core/repo/package-json.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("finalizeCitadel", () => {
  it("writes citadel.yaml, appends .maester/ to .gitignore, and adds the sync script", async () => {
    const result = await finalizeCitadel(repo.path, [
      { name: "alpha", url: "https://example.com/a.git" },
      { name: "beta", url: "https://example.com/b.git", ref: "main" },
    ]);
    expect(result.citadelPath.endsWith("citadel.yaml")).toBe(true);
    expect(result.gitignoreAdded).toEqual([".maester/"]);
    expect(result.packageJsonScript).toBe("added");

    const config = await loadCitadelConfig(repo.path);
    expect(config.sources).toHaveLength(2);

    const gitignore = await readFile(repo.resolve(".gitignore"), "utf8");
    expect(gitignore).toContain(".maester/");

    const pkg = JSON.parse(await readFile(repo.resolve("package.json"), "utf8"));
    expect(pkg.scripts["maester:sync"]).toBe("maester sync");
  });

  it("does not re-add the .gitignore entry on a second run", async () => {
    await finalizeCitadel(repo.path, [{ name: "alpha", url: "https://example.com/a.git" }]);
    // Already exists — simulate a second call with the same sources
    const result = await finalizeCitadel(repo.path, [
      { name: "alpha", url: "https://example.com/a.git" },
    ]);
    expect(result.gitignoreAdded).toEqual([]);
  });

  it("reports 'already-set' when the maester:sync script already matches", async () => {
    await ensureScript(repo.path, "maester:sync", "maester sync");
    const result = await finalizeCitadel(repo.path, [
      { name: "alpha", url: "https://example.com/a.git" },
    ]);
    expect(result.packageJsonScript).toBe("already-set");
  });

  it("reports 'no-package-json' when package.json is absent", async () => {
    await repo.cleanup();
    repo = await makeTmpRepo({ withPackageJson: false });
    const result = await finalizeCitadel(repo.path, [
      { name: "alpha", url: "https://example.com/a.git" },
    ]);
    expect(result.packageJsonScript).toBe("no-package-json");
  });
});

describe("detectDestinationCollisions", () => {
  it("throws when two sources resolve to the same destination", () => {
    expect(() =>
      detectDestinationCollisions(repo.path, [
        { name: "alpha", url: "https://example.com/a.git", destination: "shared" },
        { name: "beta", url: "https://example.com/b.git", destination: "shared" },
      ]),
    ).toThrow(/destination/);
  });

  it("does not throw when destinations differ", () => {
    expect(() =>
      detectDestinationCollisions(repo.path, [
        { name: "alpha", url: "https://example.com/a.git" },
        { name: "beta", url: "https://example.com/b.git" },
      ]),
    ).not.toThrow();
  });
});
