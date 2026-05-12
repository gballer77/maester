import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverManifestFromCache } from "../../../../src/core/sync/filters.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo({ withGit: false });
});
afterEach(async () => {
  await repo.cleanup();
});

async function cache(): Promise<string> {
  const dir = resolve(repo.path, ".maester/cache/alpha");
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("discoverManifestFromCache", () => {
  it("returns absent when no maester.yaml exists", async () => {
    const dir = await cache();
    const result = await discoverManifestFromCache(dir);
    expect(result.mode).toBe("no-manifest");
  });

  it("returns the document paths when a valid manifest exists", async () => {
    const dir = await cache();
    await writeFile(
      resolve(dir, "maester.yaml"),
      "schemaVersion: 1\ndocuments:\n  - path: README.md\n  - path: docs/*.md\n",
      "utf8",
    );
    const result = await discoverManifestFromCache(dir);
    expect(result.mode).toBe("manifest");
    if (result.mode === "manifest") {
      expect(result.patterns).toContain("README.md");
      expect(result.patterns).toContain("docs/*.md");
      expect(result.patterns).toContain("maester.yaml");
    }
  });

  it("falls back when the manifest is schema-invalid", async () => {
    const dir = await cache();
    await writeFile(resolve(dir, "maester.yaml"), "schemaVersion: 99\ndocuments: []\n", "utf8");
    const result = await discoverManifestFromCache(dir);
    expect(result.mode).toBe("no-manifest");
    if (result.mode === "no-manifest") expect(result.reason).toBe("invalid");
  });
});
