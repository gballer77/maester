import { mkdir, readFile, writeFile } from "node:fs/promises";
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

  it("writes a v2 marker with mode, filterMode, and excludes", async () => {
    const dir = resolve(repo.path, "citadel/whole");
    await mkdir(dir, { recursive: true });
    await writeProvenanceMarker(dir, {
      sourceName: "whole",
      sourceUrl: "https://example.com/w.git",
      ref: undefined,
      commitSha: "a".repeat(40),
      mode: "link",
      filterMode: "whole-repository",
      filterSet: ["**"],
      excludes: ["**/node_modules/**", "archive/**"],
      syncedAt: "2025-01-02T03:04:05.000Z",
    });
    const raw = JSON.parse(await readFile(resolve(dir, PROVENANCE_FILENAME), "utf8"));
    expect(raw).toMatchObject({ markerVersion: 2, kind: "git", mode: "link" });
    const marker = await readProvenanceMarker(dir);
    expect(marker).toMatchObject({
      mode: "link",
      filterMode: "whole-repository",
      excludes: ["**/node_modules/**", "archive/**"],
    });
  });

  it("defaults mode to copy when the writer is not told otherwise", async () => {
    const dir = resolve(repo.path, "citadel/copy");
    await mkdir(dir, { recursive: true });
    await writeProvenanceMarker(dir, {
      sourceName: "copy",
      sourceUrl: "https://example.com/c.git",
      ref: "main",
      commitSha: "b".repeat(40),
      filterSet: ["README.md"],
      syncedAt: "2025-01-02T03:04:05.000Z",
    });
    expect((await readProvenanceMarker(dir))?.mode).toBe("copy");
  });

  it("upgrades a legacy (pre-v2) marker in memory", async () => {
    const dir = resolve(repo.path, "citadel/legacy");
    await mkdir(dir, { recursive: true });
    const legacy = {
      sourceName: "legacy",
      sourceUrl: "https://example.com/l.git",
      ref: "main",
      commitSha: "c".repeat(40),
      filterSet: ["docs/**"],
      syncedAt: "2024-01-01T00:00:00.000Z",
    };
    await writeFile(resolve(dir, PROVENANCE_FILENAME), JSON.stringify(legacy), "utf8");
    const marker = await readProvenanceMarker(dir);
    expect(marker).toMatchObject({ markerVersion: 2, kind: "git", mode: "copy" });
    expect(marker?.filterMode).toBeUndefined();
  });

  it("ignores unknown mode and filterMode values", async () => {
    const dir = resolve(repo.path, "citadel/odd");
    await mkdir(dir, { recursive: true });
    const odd = {
      sourceName: "odd",
      sourceUrl: "https://example.com/o.git",
      commitSha: "d".repeat(40),
      filterSet: [],
      mode: "teleport",
      filterMode: "everything",
    };
    await writeFile(resolve(dir, PROVENANCE_FILENAME), JSON.stringify(odd), "utf8");
    const marker = await readProvenanceMarker(dir);
    expect(marker?.mode).toBe("copy");
    expect(marker?.filterMode).toBeUndefined();
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
