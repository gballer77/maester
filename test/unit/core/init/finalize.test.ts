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
    const result = await finalizeCitadel(repo.path, {
      maesters: [
        { name: "alpha", url: "https://example.com/a.git" },
        { name: "beta", url: "https://example.com/b.git", ref: "main" },
      ],
      ravens: [],
    });
    expect(result.citadelPath.endsWith("citadel.yaml")).toBe(true);
    expect(result.gitignoreAdded).toEqual([".maester/"]);
    expect(result.packageJsonScript).toBe("added");

    const config = await loadCitadelConfig(repo.path);
    expect(config.maesters).toHaveLength(2);
    expect(config.ravens).toEqual([]);

    const gitignore = await readFile(repo.resolve(".gitignore"), "utf8");
    expect(gitignore).toContain(".maester/");

    const pkg = JSON.parse(await readFile(repo.resolve("package.json"), "utf8"));
    expect(pkg.scripts["maester:sync"]).toBe("maester sync");
  });

  it("writes a citadel containing both maesters and ravens", async () => {
    await finalizeCitadel(repo.path, {
      maesters: [{ name: "alpha", url: "https://example.com/a.git" }],
      ravens: [
        {
          name: "react-docs",
          url: "https://github.com/facebook/react.git",
          includes: ["docs/**/*.md", "README.md"],
        },
      ],
    });
    const config = await loadCitadelConfig(repo.path);
    expect(config.maesters[0]?.name).toBe("alpha");
    expect(config.ravens[0]?.name).toBe("react-docs");
    expect(config.ravens[0]?.includes).toEqual(["docs/**/*.md", "README.md"]);
  });

  it("does not re-add the .gitignore entry on a second run", async () => {
    await finalizeCitadel(repo.path, {
      maesters: [{ name: "alpha", url: "https://example.com/a.git" }],
      ravens: [],
    });
    const result = await finalizeCitadel(repo.path, {
      maesters: [{ name: "alpha", url: "https://example.com/a.git" }],
      ravens: [],
    });
    expect(result.gitignoreAdded).toEqual([]);
  });

  it("reports 'already-set' when the maester:sync script already matches", async () => {
    await ensureScript(repo.path, "maester:sync", "maester sync");
    const result = await finalizeCitadel(repo.path, {
      maesters: [{ name: "alpha", url: "https://example.com/a.git" }],
      ravens: [],
    });
    expect(result.packageJsonScript).toBe("already-set");
  });

  it("reports 'no-package-json' when package.json is absent", async () => {
    await repo.cleanup();
    repo = await makeTmpRepo({ withPackageJson: false });
    const result = await finalizeCitadel(repo.path, {
      maesters: [{ name: "alpha", url: "https://example.com/a.git" }],
      ravens: [],
    });
    expect(result.packageJsonScript).toBe("no-package-json");
  });
});

describe("detectDestinationCollisions", () => {
  it("throws when two maesters resolve to the same destination", () => {
    expect(() =>
      detectDestinationCollisions(repo.path, {
        maesters: [
          { name: "alpha", url: "https://example.com/a.git", destination: "shared" },
          { name: "beta", url: "https://example.com/b.git", destination: "shared" },
        ],
        ravens: [],
      }),
    ).toThrow(/destination/);
  });

  it("throws when a maester and a raven resolve to the same destination", () => {
    expect(() =>
      detectDestinationCollisions(repo.path, {
        maesters: [{ name: "alpha", url: "https://example.com/a.git", destination: "shared" }],
        ravens: [
          {
            name: "beta",
            url: "https://example.com/b.git",
            includes: ["README.md"],
            destination: "shared",
          },
        ],
      }),
    ).toThrow(/destination/);
  });

  it("does not throw when destinations differ across kinds", () => {
    expect(() =>
      detectDestinationCollisions(repo.path, {
        maesters: [{ name: "alpha", url: "https://example.com/a.git" }],
        ravens: [
          {
            name: "beta",
            url: "https://example.com/b.git",
            includes: ["README.md"],
          },
        ],
      }),
    ).not.toThrow();
  });
});
