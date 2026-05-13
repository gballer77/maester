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
  it("returns the new shape verbatim when written by the current build", async () => {
    const dir = resolve(repo.path, "citadel/alpha");
    await mkdir(dir, { recursive: true });
    await writeProvenanceMarker(dir, {
      kind: "raven",
      sourceName: "alpha",
      sourceUrl: "https://example.com/r.git",
      ref: "main",
      commitSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      filterSet: ["docs/**"],
      syncedAt: "2025-01-02T03:04:05.000Z",
    });
    const marker = await readProvenanceMarker(dir);
    expect(marker?.kind).toBe("raven");
    expect(marker?.sourceName).toBe("alpha");
    expect(marker?.filterSet).toEqual(["docs/**"]);
  });

  it("normalizes a legacy maesterName-only marker to the new shape", async () => {
    const dir = resolve(repo.path, "citadel/legacy");
    await mkdir(dir, { recursive: true });
    const legacy = {
      maesterName: "legacy",
      sourceUrl: "https://example.com/r.git",
      ref: "main",
      commitSha: "cafebabecafebabecafebabecafebabecafebabe",
      syncedAt: "2024-12-31T23:59:59.000Z",
    };
    await writeFile(resolve(dir, PROVENANCE_FILENAME), JSON.stringify(legacy, null, 2), "utf8");
    const marker = await readProvenanceMarker(dir);
    expect(marker?.kind).toBe("maester");
    expect(marker?.sourceName).toBe("legacy");
    // filterSet is intentionally absent on legacy markers so the runner
    // treats it as drift and re-checks out.
    expect(marker?.filterSet).toBeUndefined();
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

  it("matches 'all' with 'all'", () => {
    expect(filterSetMatches("all", "all")).toBe(true);
  });

  it("does not match 'all' against a glob list", () => {
    expect(filterSetMatches("all", ["a"])).toBe(false);
    expect(filterSetMatches(["a"], "all")).toBe(false);
  });

  it("treats undefined as a no-match (forces re-checkout)", () => {
    expect(filterSetMatches(undefined, ["a"])).toBe(false);
    expect(filterSetMatches(["a"], undefined)).toBe(false);
    expect(filterSetMatches(undefined, undefined)).toBe(false);
  });
});
