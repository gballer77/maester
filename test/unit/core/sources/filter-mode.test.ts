import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_EXCLUDES } from "../../../../src/core/sources/excludes.js";
import {
  type ManifestProbe,
  readManifestProbe,
  resolveFilterMode,
} from "../../../../src/core/sources/filter-mode.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

const VALID: ManifestProbe = {
  kind: "valid",
  patterns: ["maester.yaml", "README.md"],
  rules: [{ pattern: "README.md" }],
};

describe("resolveFilterMode", () => {
  it("uses includes whenever they are declared, regardless of the manifest", () => {
    const result = resolveFilterMode(
      { includes: ["docs/**", { path: "README.md", state: "canon" }] },
      VALID,
    );
    expect(result).toEqual({
      mode: "includes",
      patterns: ["docs/**", "README.md"],
      rules: [{ pattern: "docs/**" }, { pattern: "README.md", state: "canon" }],
    });
  });

  it("uses the manifest when it publishes at least one document", () => {
    const result = resolveFilterMode({}, VALID);
    expect(result.mode).toBe("manifest");
  });

  it("falls back to whole-repository when the manifest has no entries", () => {
    const result = resolveFilterMode({}, { kind: "empty" });
    expect(result).toMatchObject({ mode: "whole-repository", reason: "empty-manifest" });
  });

  it("falls back to whole-repository when there is no manifest", () => {
    const result = resolveFilterMode({}, { kind: "absent" });
    expect(result).toMatchObject({ mode: "whole-repository", reason: "no-manifest" });
  });

  it("never treats an invalid manifest as publish-everything", () => {
    expect(resolveFilterMode({}, { kind: "invalid" })).toEqual({ mode: "invalid-manifest" });
  });

  it("puts built-in excludes before the source's own excludes", () => {
    const result = resolveFilterMode({ excludes: ["archive/**"] }, { kind: "absent" });
    if (result.mode !== "whole-repository") throw new Error("expected whole-repository");
    expect(result.excludes).toEqual([...BUILTIN_EXCLUDES, "archive/**"]);
  });
});

describe("readManifestProbe", () => {
  let repo: TempRepo;
  beforeEach(async () => {
    repo = await makeTmpRepo({ withGit: false, withPackageJson: false });
  });
  afterEach(async () => {
    await repo.cleanup();
  });

  async function manifest(body: string): Promise<ManifestProbe> {
    await mkdir(repo.path, { recursive: true });
    await writeFile(resolve(repo.path, "maester.yaml"), body, "utf8");
    return readManifestProbe(repo.path);
  }

  it("reports absent when there is no maester.yaml", async () => {
    expect(await readManifestProbe(repo.path)).toEqual({ kind: "absent" });
  });

  it("reports empty for an entry-less manifest", async () => {
    expect(await manifest("schemaVersion: 1\ndocuments: []\n")).toEqual({ kind: "empty" });
  });

  it("reports empty when documents is omitted", async () => {
    expect(await manifest("schemaVersion: 1\n")).toEqual({ kind: "empty" });
  });

  it("reports invalid for a schema-invalid manifest", async () => {
    expect(await manifest("schemaVersion: 2\ndocuments: []\n")).toEqual({ kind: "invalid" });
  });

  it("returns patterns including the manifest itself for a valid manifest", async () => {
    const probe = await manifest(
      "schemaVersion: 1\ndocuments:\n  - path: docs/*.md\n    state: canon\n",
    );
    expect(probe).toEqual({
      kind: "valid",
      patterns: ["maester.yaml", "docs/*.md"],
      rules: [{ pattern: "docs/*.md", state: "canon" }],
    });
  });
});
