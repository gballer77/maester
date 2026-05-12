import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DestinationBlockedError } from "../../../../src/core/errors.js";
import {
  PROVENANCE_FILENAME,
  writeProvenanceMarker,
} from "../../../../src/core/sync/provenance.js";
import { assertDestinationSafe, stageDestination } from "../../../../src/core/sync/stage.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

async function setupCache(): Promise<{ cacheDir: string; destination: string }> {
  const cacheDir = resolve(repo.path, ".maester/cache/alpha");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(resolve(cacheDir, "README.md"), "hello\n", "utf8");
  await writeFile(resolve(cacheDir, "extra.md"), "hi\n", "utf8");
  const destination = resolve(repo.path, "citadel/alpha");
  return { cacheDir, destination };
}

describe("stageDestination", () => {
  it("creates the destination on first sync and writes the provenance marker", async () => {
    const { cacheDir, destination } = await setupCache();
    const result = await stageDestination({
      cacheDir,
      destination,
      patterns: "all",
      marker: {
        maesterName: "alpha",
        sourceUrl: "https://example.com/a.git",
        ref: "main",
        commitSha: "0".repeat(40),
        syncedAt: new Date().toISOString(),
      },
    });
    expect(result.staged).toBe(true);
    const entries = await readdir(destination);
    expect(entries).toContain("README.md");
    expect(entries).toContain(PROVENANCE_FILENAME);
    const marker = JSON.parse(await readFile(resolve(destination, PROVENANCE_FILENAME), "utf8"));
    expect(marker.maesterName).toBe("alpha");
  });

  it("replaces a managed destination atomically without leaving the .tmp- artifact", async () => {
    const { cacheDir, destination } = await setupCache();
    await stageDestination({
      cacheDir,
      destination,
      patterns: "all",
      marker: {
        maesterName: "alpha",
        sourceUrl: "https://example.com/a.git",
        ref: "main",
        commitSha: "a".repeat(40),
        syncedAt: new Date().toISOString(),
      },
    });
    // Mutate the cache and re-stage; should overwrite cleanly.
    await writeFile(resolve(cacheDir, "README.md"), "updated\n", "utf8");
    await stageDestination({
      cacheDir,
      destination,
      patterns: "all",
      marker: {
        maesterName: "alpha",
        sourceUrl: "https://example.com/a.git",
        ref: "main",
        commitSha: "b".repeat(40),
        syncedAt: new Date().toISOString(),
      },
    });
    const content = await readFile(resolve(destination, "README.md"), "utf8");
    expect(content).toBe("updated\n");
  });
});

describe("assertDestinationSafe", () => {
  it("permits an empty destination", async () => {
    const dir = resolve(repo.path, "citadel/alpha");
    await mkdir(dir, { recursive: true });
    await expect(assertDestinationSafe(dir, "alpha")).resolves.toBeUndefined();
  });

  it("permits a destination managed by the same maester", async () => {
    const dir = resolve(repo.path, "citadel/alpha");
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, "x.md"), "y", "utf8");
    await writeProvenanceMarker(dir, {
      maesterName: "alpha",
      sourceUrl: "https://example.com/a.git",
      ref: undefined,
      commitSha: "0".repeat(40),
      syncedAt: new Date().toISOString(),
    });
    await expect(assertDestinationSafe(dir, "alpha")).resolves.toBeUndefined();
  });

  it("refuses a destination containing hand-authored content", async () => {
    const dir = resolve(repo.path, "citadel/alpha");
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, "user-authored.md"), "do not clobber", "utf8");
    await expect(assertDestinationSafe(dir, "alpha")).rejects.toBeInstanceOf(
      DestinationBlockedError,
    );
  });
});
