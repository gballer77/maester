import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCitadelConfig, loadMaesterConfig } from "../../../../src/core/config/loader.js";
import { writeCitadelConfig, writeMaesterConfig } from "../../../../src/core/config/writer.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("writeCitadelConfig", () => {
  it("writes a citadel.yaml with the documented header comment and v2 fields", async () => {
    const path = await writeCitadelConfig(repo.path, {
      schemaVersion: 2,
      maesters: [{ name: "design-system", url: "https://example.com/d.git" }],
      ravens: [],
    });
    const text = await readFile(path, "utf8");
    expect(text).toContain("# citadel.yaml");
    expect(text).toContain("design-system");
    expect(text).toContain("schemaVersion: 2");
    expect(text).toContain("maesters:");
    expect(text).toContain("ravens:");
  });

  it("round-trips a citadel with both maesters and ravens through loadCitadelConfig", async () => {
    await writeCitadelConfig(repo.path, {
      schemaVersion: 2,
      maesters: [
        { name: "alpha", url: "https://example.com/a.git", ref: "main" },
        {
          name: "beta",
          url: "https://example.com/b.git",
          auth: { type: "token", envVar: "MAESTER_BETA_TOKEN" },
        },
      ],
      ravens: [
        {
          name: "vendor-docs",
          url: "https://example.com/v.git",
          includes: ["openapi/**/*.yaml", "CHANGELOG.md"],
          description: "Vendor spec",
          tags: ["api", "vendor"],
        },
      ],
    });
    const loaded = await loadCitadelConfig(repo.path);
    expect(loaded.maesters).toHaveLength(2);
    expect(loaded.maesters[1]?.auth).toEqual({ type: "token", envVar: "MAESTER_BETA_TOKEN" });
    expect(loaded.ravens).toHaveLength(1);
    expect(loaded.ravens[0]?.includes).toEqual(["openapi/**/*.yaml", "CHANGELOG.md"]);
    expect(loaded.ravens[0]?.tags).toEqual(["api", "vendor"]);
  });
});

describe("writeMaesterConfig", () => {
  it("round-trips through loadMaesterConfig", async () => {
    await writeMaesterConfig(repo.path, {
      schemaVersion: 1,
      documents: [{ path: "README.md", category: "readme" }, { path: "docs/adr/*.md" }],
    });
    const loaded = await loadMaesterConfig(repo.path);
    expect(loaded.documents).toHaveLength(2);
    expect(loaded.documents[0]?.path).toBe("README.md");
  });
});
