import { mkdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIncludeEntry, buildSourceEntry } from "../../../../src/cli/commands/init.js";
import {
  validateLocalDirectory,
  validateLocalPathShape,
} from "../../../../src/core/init/validators.js";
import { CitadelConfigSchema } from "../../../../src/schemas/citadel.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

describe("buildIncludeEntry", () => {
  it("keeps the bare-string form when the user picks 'file header'", () => {
    expect(buildIncludeEntry("docs/**/*.md", "file-header")).toBe("docs/**/*.md");
  });

  it("emits the enriched form with state: draft when the user picks 'draft'", () => {
    expect(buildIncludeEntry("README.md", "draft")).toEqual({
      path: "README.md",
      state: "draft",
    });
  });

  it("emits the enriched form with state: canon when the user picks 'canon'", () => {
    expect(buildIncludeEntry("docs/runbooks/**/*.md", "canon")).toEqual({
      path: "docs/runbooks/**/*.md",
      state: "canon",
    });
  });
});

describe("buildSourceEntry", () => {
  const common = { name: "notes", destination: "", description: "", tags: [] as string[] };

  function roundTrips(source: ReturnType<typeof buildSourceEntry>) {
    const parsed = CitadelConfigSchema.safeParse({ schemaVersion: 1, sources: [source] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sources[0]).toEqual(source);
  }

  it("writes a link-mode path source with the path as typed and no mode", () => {
    const source = buildSourceEntry({
      ...common,
      location: { kind: "path", path: "${DOCS_HOME}/notes", mode: "link", includes: [] },
    });
    expect(source).toEqual({ name: "notes", path: "${DOCS_HOME}/notes" });
    roundTrips(source);
  });

  it("writes mode: copy and includes for a copy-mode path source", () => {
    const source = buildSourceEntry({
      ...common,
      destination: "kb/notes",
      tags: ["internal"],
      location: { kind: "path", path: "../notes", mode: "copy", includes: ["**/*.md"] },
    });
    expect(source).toEqual({
      name: "notes",
      path: "../notes",
      mode: "copy",
      includes: ["**/*.md"],
      destination: "kb/notes",
      tags: ["internal"],
    });
    roundTrips(source);
  });

  it("writes a git source without path or mode", () => {
    const source = buildSourceEntry({
      ...common,
      location: {
        kind: "git",
        url: "https://x.example/r.git",
        ref: "main",
        includes: [],
        auth: { type: "token", envVar: "DOCS_TOKEN" },
      },
    });
    expect(source).toEqual({
      name: "notes",
      url: "https://x.example/r.git",
      ref: "main",
      auth: { type: "token", envVar: "DOCS_TOKEN" },
    });
    roundTrips(source);
  });
});

describe("local directory validation", () => {
  let repo: TempRepo;
  beforeEach(async () => {
    repo = await makeTmpRepo({ withGit: false, withPackageJson: false });
    await mkdir(repo.resolve("sibling"), { recursive: true });
    await mkdir(repo.resolve("citadel-repo/citadel/x"), { recursive: true });
  });
  afterEach(async () => {
    await repo.cleanup();
  });
  const ctx = () => ({ repoRoot: repo.resolve("citadel-repo"), baseDir: "citadel", env: {} });

  it("checks the shape synchronously", () => {
    expect(validateLocalPathShape("").ok).toBe(false);
    expect(validateLocalPathShape("${lower}").ok).toBe(false);
    expect(validateLocalPathShape("../notes").ok).toBe(true);
  });

  it("accepts an existing sibling directory and returns its real path", async () => {
    const result = await validateLocalDirectory("n", "../sibling", ctx());
    expect(result.ok).toBe(true);
  });

  it("rejects a missing directory, an unset variable, and an overlap", async () => {
    expect(await validateLocalDirectory("n", "../missing", ctx())).toMatchObject({ ok: false });
    expect(await validateLocalDirectory("n", "${UNSET_X}", ctx())).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/UNSET_X/),
    });
    expect(await validateLocalDirectory("n", "citadel/x", ctx())).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/base directory/),
    });
  });
});
