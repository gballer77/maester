import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROVENANCE_FILENAME,
  filterSetMatches,
  readProvenanceMarker,
  writeProvenanceMarker,
} from "../../../../src/core/sync/provenance.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo({ withGit: false });
});
afterEach(async () => {
  await repo.cleanup();
});

describe("readProvenanceMarker", () => {
  it("returns the marker verbatim when written by the current build", async () => {
    const dir = resolve(repo.path, "citadel/alpha");
    await mkdir(dir, { recursive: true });
    await writeProvenanceMarker(dir, {
      sourceName: "alpha",
      sourceUrl: "https://example.com/r.git",
      ref: "main",
      commitSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      filterSet: ["docs/**"],
      syncedAt: "2025-01-02T03:04:05.000Z",
    });
    const marker = await readProvenanceMarker(dir);
    expect(marker?.sourceName).toBe("alpha");
    expect(marker?.filterSet).toEqual(["docs/**"]);
  });

  it("returns undefined when required fields are missing", async () => {
    const dir = resolve(repo.path, "citadel/invalid");
    await mkdir(dir, { recursive: true });
    const malformed = { sourceUrl: "https://example.com/r.git" };
    await writeFile(resolve(dir, PROVENANCE_FILENAME), JSON.stringify(malformed, null, 2), "utf8");
    const marker = await readProvenanceMarker(dir);
    expect(marker).toBeUndefined();
  });

  it("returns undefined when the marker file is absent", async () => {
    const dir = resolve(repo.path, "citadel/missing");
    await mkdir(dir, { recursive: true });
    const marker = await readProvenanceMarker(dir);
    expect(marker).toBeUndefined();
  });
});

describe("filterSetMatches", () => {
  it("matches identical glob lists", () => {
    expect(filterSetMatches(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("rejects different lengths or different content", () => {
    expect(filterSetMatches(["a"], ["a", "b"])).toBe(false);
    expect(filterSetMatches(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("matches two empty lists", () => {
    expect(filterSetMatches([], [])).toBe(true);
  });
});
