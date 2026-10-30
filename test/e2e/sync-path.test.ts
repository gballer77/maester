import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROVENANCE_FILENAME } from "../../src/core/sync/provenance.js";
import { runSync } from "../../src/core/sync/runner.js";
import type { CitadelConfig } from "../../src/schemas/citadel.js";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

// The citadel repo and the local source directory are separate temp dirs, so
// the source is reached through a `../…` path like a sibling checkout.
let repo: TempRepo;
let notes: TempRepo;
let notesRel: string;

beforeEach(async () => {
  repo = await makeTmpRepo();
  notes = await makeTmpRepo({ withGit: false, withPackageJson: false });
  notesRel = relative(repo.path, notes.path);
  await put(notes, "README.md", "# notes\n");
  await put(notes, "guides/setup.md", "setup\n");
});

afterEach(async () => {
  await repo.cleanup();
  await notes.cleanup();
});

async function put(root: TempRepo, rel: string, contents: string): Promise<void> {
  const path = root.resolve(rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

function config(...sources: Record<string, unknown>[]): CitadelConfig {
  return { schemaVersion: 1, sources } as CitadelConfig;
}

function pathSource(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: "notes", path: notesRel, ...extra };
}

async function sync(cfg: CitadelConfig) {
  return runSync(cfg, { repoRoot: repo.path, env: { NOTES_HOME: notes.path } });
}

async function isLink(rel: string): Promise<boolean> {
  return (await lstat(repo.resolve(rel))).isSymbolicLink();
}

async function marker(dest = "citadel/notes"): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(repo.resolve(dest, PROVENANCE_FILENAME), "utf8"));
}

describe("runSync: path sources in link mode (default)", () => {
  it("links each file with relative targets and gitignores the destination", async () => {
    const result = await sync(config(pathSource({ includes: ["**/*.md"] })));
    expect(result.failed).toBe(0);
    expect(result.outcomes[0]).toMatchObject({
      kind: "path",
      status: "added",
      mode: "link",
      filterMode: "includes",
      fileCount: 2,
      gitignoreEntry: "/citadel/notes/",
    });
    expect(result.outcomes[0]?.sourcePath?.endsWith(notes.path.split("/").pop() ?? "")).toBe(true);
    expect(await isLink("citadel/notes/guides/setup.md")).toBe(true);
    const target = await readlink(repo.resolve("citadel/notes/guides/setup.md"));
    expect(isAbsolute(target)).toBe(false);
    expect(await readFile(repo.resolve("citadel/notes/guides/setup.md"), "utf8")).toBe("setup\n");
    expect(await readFile(repo.resolve(".gitignore"), "utf8")).toContain("/citadel/notes/");
    expect(await marker()).toMatchObject({
      kind: "path",
      sourcePath: notesRel,
      mode: "link",
      fileCount: 2,
    });
  });

  it("links the whole directory when there is no manifest and no includes", async () => {
    await put(notes, "node_modules/x/index.js", "x\n");
    const result = await sync(config(pathSource()));
    expect(result.outcomes[0]).toMatchObject({
      status: "added",
      mode: "link",
      filterMode: "whole-repository",
      wholeRepoReason: "no-manifest",
      fileCount: 2,
    });
    expect(existsSync(repo.resolve("citadel/notes/node_modules"))).toBe(false);
  });

  it("stays unchanged across content edits, which show through the links", async () => {
    const cfg = config(pathSource({ includes: ["**/*.md"] }));
    await sync(cfg);
    await put(notes, "README.md", "# edited live\n");
    const second = await sync(cfg);
    expect(second.outcomes[0]?.status).toBe("unchanged");
    expect(await readFile(repo.resolve("citadel/notes/README.md"), "utf8")).toBe("# edited live\n");
  });

  it("links a new file and unlinks a removed one on the next sync", async () => {
    const cfg = config(pathSource({ includes: ["**/*.md"] }));
    await sync(cfg);
    await put(notes, "new.md", "new\n");
    await rm(notes.resolve("guides/setup.md"));
    const result = await sync(cfg);
    expect(result.outcomes[0]?.status).toBe("updated");
    expect(await isLink("citadel/notes/new.md")).toBe(true);
    expect(existsSync(repo.resolve("citadel/notes/guides/setup.md"))).toBe(false);
  });

  it("uses absolute link targets for a ${VAR} path", async () => {
    await sync(config(pathSource({ path: "${NOTES_HOME}", includes: ["README.md"] })));
    expect(isAbsolute(await readlink(repo.resolve("citadel/notes/README.md")))).toBe(true);
  });

  it("surfaces a manifest's published set", async () => {
    await put(notes, "maester.yaml", "schemaVersion: 1\ndocuments:\n  - path: guides/*.md\n");
    const result = await sync(config(pathSource()));
    expect(result.outcomes[0]?.filterMode).toBe("manifest");
    expect(existsSync(repo.resolve("citadel/notes/guides/setup.md"))).toBe(true);
    expect(existsSync(repo.resolve("citadel/notes/README.md"))).toBe(false);
  });
});

describe("runSync: path sources in copy mode", () => {
  const copy = () => pathSource({ mode: "copy", includes: ["**/*.md"] });

  it("mirrors only the resolved files, as regular files, and does not gitignore", async () => {
    await put(notes, "skip.txt", "not included\n");
    const result = await sync(config(copy()));
    expect(result.outcomes[0]).toMatchObject({ kind: "path", status: "added", mode: "copy" });
    expect(result.outcomes[0]?.gitignoreEntry).toBeUndefined();
    expect(await isLink("citadel/notes/README.md")).toBe(false);
    // Inline state tagging applies to copies exactly as for git sources.
    expect(await readFile(repo.resolve("citadel/notes/guides/setup.md"), "utf8")).toMatch(
      /^---\nstate: draft\n---\nsetup\n$/,
    );
    expect(existsSync(repo.resolve("citadel/notes/skip.txt"))).toBe(false);
    expect(await marker()).toMatchObject({ kind: "path", mode: "copy" });
  });

  it("applies inline state to the copy and leaves the original untouched", async () => {
    const result = await sync(
      config(pathSource({ mode: "copy", includes: [{ path: "README.md", state: "canon" }] })),
    );
    expect(result.outcomes[0]?.stateBreakdown).toMatchObject({ canon: 1 });
    expect(await readFile(repo.resolve("citadel/notes/README.md"), "utf8")).toContain(
      "state: canon",
    );
    expect(await readFile(notes.resolve("README.md"), "utf8")).toBe("# notes\n");
  });

  it("is unchanged with no edits, updated on an edit, and drops stale files", async () => {
    const cfg = config(copy());
    await sync(cfg);
    expect((await sync(cfg)).outcomes[0]?.status).toBe("unchanged");

    await put(notes, "README.md", "# edited\n");
    await rm(notes.resolve("guides/setup.md"));
    const result = await sync(cfg);
    expect(result.outcomes[0]?.status).toBe("updated");
    expect(await readFile(repo.resolve("citadel/notes/README.md"), "utf8")).toContain("# edited\n");
    expect(existsSync(repo.resolve("citadel/notes/guides/setup.md"))).toBe(false);
  });

  it("fails copy mode on a whole directory while other sources continue", async () => {
    const result = await sync(
      config(pathSource({ mode: "copy" }), {
        name: "linked",
        path: notesRel,
        includes: ["README.md"],
      }),
    );
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]).toMatchObject({ kind: "path", status: "failed" });
    expect(result.outcomes[0]?.error).toMatch(/copy mode requires an `includes` list/i);
    expect(result.outcomes[1]?.status).toBe("added");
  });
});

describe("runSync: path source failures are per-source", () => {
  it("fails a missing directory and an unset variable without stopping others", async () => {
    const result = await runSync(
      config(
        { name: "gone", path: "../definitely-not-here-xyz" },
        { name: "unset", path: "${NOT_SET_ANYWHERE}/docs" },
        pathSource({ includes: ["README.md"] }),
      ),
      { repoRoot: repo.path, env: {} },
    );
    expect(result.failed).toBe(2);
    expect(result.outcomes[0]?.error).toMatch(/does not exist/);
    expect(result.outcomes[1]?.error).toMatch(/\$\{NOT_SET_ANYWHERE\}, which is not set/);
    expect(result.outcomes[2]?.status).toBe("added");
  });

  it("fails an invalid manifest and warns on zero includes matches", async () => {
    await put(notes, "maester.yaml", "schemaVersion: 99\n");
    const invalid = await sync(config(pathSource()));
    expect(invalid.outcomes[0]?.error).toMatch(/failed schema validation/);

    const none = await sync(config(pathSource({ includes: ["nope/*.md"] })));
    expect(none.failed).toBe(0);
    expect(none.outcomes[0]?.warnings).toContainEqual({
      type: "no-matches",
      name: "notes",
      includes: ["nope/*.md"],
    });
  });

  it("refuses a ${VAR} path that resolves into the citadel output", async () => {
    await mkdir(repo.resolve("citadel/other"), { recursive: true });
    const result = await runSync(config({ name: "loop", path: "${OUT}" }), {
      repoRoot: repo.path,
      env: { OUT: resolve(repo.path, "citadel/other") },
    });
    expect(result.outcomes[0]?.error).toMatch(/inside the citadel base directory/);
  });
});
