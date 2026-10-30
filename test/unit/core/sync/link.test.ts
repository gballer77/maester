import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DestinationBlockedError } from "../../../../src/core/errors.js";
import { findDanglingLinks, stageLinks } from "../../../../src/core/sync/link.js";
import {
  type ProvenanceMarkerInput,
  readProvenanceMarker,
} from "../../../../src/core/sync/provenance.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
let cache: string;
let destination: string;

const MARKER: ProvenanceMarkerInput = {
  sourceName: "handbook",
  sourceUrl: "https://example.com/h.git",
  ref: undefined,
  commitSha: "e".repeat(40),
  filterMode: "whole-repository",
  filterSet: ["**"],
  syncedAt: "2025-01-02T03:04:05.000Z",
};

beforeEach(async () => {
  repo = await makeTmpRepo({ withGit: false, withPackageJson: false });
  cache = repo.resolve(".maester/cache/handbook");
  destination = repo.resolve("citadel/handbook");
  await put(cache, "README.md", "# Handbook\n");
  await put(cache, "guides/setup.md", "setup\n");
});
afterEach(async () => {
  await repo.cleanup();
});

async function put(root: string, rel: string, contents: string): Promise<void> {
  const path = resolve(root, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function link(files: string[], relativeTargets = true): Promise<void> {
  await stageLinks({ files, targetRoot: cache, destination, marker: MARKER, relativeTargets });
}

describe("stageLinks", () => {
  it("creates one link per file that resolves to the original", async () => {
    await link(["README.md", "guides/setup.md"]);
    expect((await lstat(resolve(destination, "guides/setup.md"))).isSymbolicLink()).toBe(true);
    expect(await readFile(resolve(destination, "guides/setup.md"), "utf8")).toBe("setup\n");
  });

  it("writes relative targets computed from the final destination", async () => {
    await link(["guides/setup.md"]);
    const target = await readlink(resolve(destination, "guides/setup.md"));
    expect(isAbsolute(target)).toBe(false);
    expect(target).toBe("../../../.maester/cache/handbook/guides/setup.md");
  });

  it("writes absolute targets when asked", async () => {
    await link(["README.md"], false);
    expect(await readlink(resolve(destination, "README.md"))).toBe(resolve(cache, "README.md"));
  });

  it("reflects edits to the original without re-staging", async () => {
    await link(["README.md"]);
    await writeFile(resolve(cache, "README.md"), "# Edited\n", "utf8");
    expect(await readFile(resolve(destination, "README.md"), "utf8")).toBe("# Edited\n");
  });

  it("records a link-mode provenance marker", async () => {
    await link(["README.md"]);
    const marker = await readProvenanceMarker(destination);
    expect(marker).toMatchObject({ mode: "link", filterMode: "whole-repository" });
  });

  it("removes links for files dropped from the set on re-stage", async () => {
    await link(["README.md", "guides/setup.md"]);
    await link(["README.md"]);
    expect(existsSync(resolve(destination, "guides/setup.md"))).toBe(false);
    expect(existsSync(resolve(destination, "README.md"))).toBe(true);
  });

  it("refuses to overwrite a destination it does not own", async () => {
    await put(destination, "notes.md", "hand-written\n");
    await expect(link(["README.md"])).rejects.toBeInstanceOf(DestinationBlockedError);
    expect(await readFile(resolve(destination, "notes.md"), "utf8")).toBe("hand-written\n");
  });

  it("refuses file paths that escape the destination", async () => {
    await expect(link(["../escape.md"])).rejects.toThrow(/outside the destination/);
    expect(existsSync(destination)).toBe(false);
  });
});

describe("findDanglingLinks", () => {
  it("returns nothing for a healthy destination", async () => {
    await link(["README.md", "guides/setup.md"]);
    expect(await findDanglingLinks(destination)).toEqual([]);
  });

  it("lists links whose targets are gone", async () => {
    await link(["README.md", "guides/setup.md"]);
    await rm(resolve(cache, "guides"), { recursive: true });
    expect(await findDanglingLinks(destination)).toEqual(["guides/setup.md"]);
  });

  it("returns an empty list when the destination does not exist", async () => {
    expect(await findDanglingLinks(resolve(repo.path, "nope"))).toEqual([]);
  });
});
