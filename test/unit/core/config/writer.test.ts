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
  it("writes a citadel.yaml with the documented header comment and sources field", async () => {
    const path = await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [{ name: "design-system", url: "https://example.com/d.git" }],
    });
    const text = await readFile(path, "utf8");
    expect(text).toContain("# citadel.yaml");
    expect(text).toContain("design-system");
    expect(text).toContain("schemaVersion: 1");
    expect(text).toContain("sources:");
  });

  it("documents baseDir in the header comment", async () => {
    const path = await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    const text = await readFile(path, "utf8");
    expect(text).toContain("baseDir");
    expect(text).toContain("citadel");
  });

  it("emits baseDir between schemaVersion and sources when set", async () => {
    const path = await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      baseDir: "vendor",
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    const text = await readFile(path, "utf8");
    const versionIdx = text.indexOf("schemaVersion:");
    const baseIdx = text.indexOf("baseDir:");
    const sourcesIdx = text.indexOf("sources:");
    expect(versionIdx).toBeGreaterThan(-1);
    expect(baseIdx).toBeGreaterThan(versionIdx);
    expect(sourcesIdx).toBeGreaterThan(baseIdx);

    const loaded = await loadCitadelConfig(repo.path);
    expect(loaded.baseDir).toBe("vendor");
  });

  it("omits baseDir entirely when undefined", async () => {
    const path = await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [{ name: "x", url: "https://example.com/r.git" }],
    });
    const text = await readFile(path, "utf8");
    expect(text).not.toMatch(/^baseDir:/m);
  });

  it("round-trips a mixed citadel through loadCitadelConfig", async () => {
    await writeCitadelConfig(repo.path, {
      schemaVersion: 1,
      sources: [
        { name: "alpha", url: "https://example.com/a.git", ref: "main" },
        {
          name: "beta",
          url: "https://example.com/b.git",
          auth: { type: "token", envVar: "MAESTER_BETA_TOKEN" },
        },
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
    expect(loaded.sources).toHaveLength(3);
    expect(loaded.sources[1]?.auth).toEqual({ type: "token", envVar: "MAESTER_BETA_TOKEN" });
    expect(loaded.sources[2]?.includes).toEqual(["openapi/**/*.yaml", "CHANGELOG.md"]);
    expect(loaded.sources[2]?.tags).toEqual(["api", "vendor"]);
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
