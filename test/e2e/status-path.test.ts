import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStatus } from "../../src/core/status/runner.js";
import { runSync } from "../../src/core/sync/runner.js";
import type { CitadelConfig } from "../../src/schemas/citadel.js";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

let repo: TempRepo;
let notes: TempRepo;
let notesRel: string;

beforeEach(async () => {
  repo = await makeTmpRepo();
  notes = await makeTmpRepo({ withGit: false, withPackageJson: false });
  notesRel = relative(repo.path, notes.path);
  await put("README.md", "# notes\n");
  await put("guides/setup.md", "setup\n");
});

afterEach(async () => {
  await repo.cleanup();
  await rm(`${notes.path}-moved`, { recursive: true, force: true });
  await notes.cleanup();
});

async function put(rel: string, contents: string): Promise<void> {
  const path = notes.resolve(rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

function config(extra: Record<string, unknown> = {}): CitadelConfig {
  return {
    schemaVersion: 1,
    sources: [{ name: "notes", path: notesRel, includes: ["**/*.md"], ...extra }],
  } as CitadelConfig;
}

async function status(cfg: CitadelConfig, env: NodeJS.ProcessEnv = {}) {
  return (await runStatus(cfg, { repoRoot: repo.path, env })).outcomes[0];
}

describe("runStatus: path sources", () => {
  it("reports never-synced with no mode, then up-to-date with the recorded mode", async () => {
    const cfg = config();
    expect(await status(cfg)).toEqual({
      name: "notes",
      kind: "path",
      verdict: "behind",
      reasons: ["never-synced"],
    });
    await runSync(cfg, { repoRoot: repo.path });
    const outcome = await status(cfg);
    expect(outcome).toMatchObject({
      kind: "path",
      verdict: "up-to-date",
      mode: "link",
      filterMode: "includes",
    });
    expect(outcome?.sourcePath).toMatch(/^\//);
  });

  it("stays up-to-date after a content edit in link mode", async () => {
    const cfg = config();
    await runSync(cfg, { repoRoot: repo.path });
    await put("README.md", "# edited\n");
    expect((await status(cfg))?.verdict).toBe("up-to-date");
  });

  it("reports local-changed after a content edit in copy mode", async () => {
    const cfg = config({ mode: "copy" });
    await runSync(cfg, { repoRoot: repo.path });
    expect((await status(cfg))?.verdict).toBe("up-to-date");
    await put("README.md", "# edited\n");
    expect(await status(cfg)).toMatchObject({ verdict: "behind", reasons: ["local-changed"] });
  });

  it("reports local-changed in link mode when a file is added", async () => {
    const cfg = config();
    await runSync(cfg, { repoRoot: repo.path });
    await put("new.md", "new\n");
    expect(await status(cfg)).toMatchObject({ verdict: "behind", reasons: ["local-changed"] });
  });

  it("reports failed / source-missing when the directory moves", async () => {
    const cfg = config();
    await runSync(cfg, { repoRoot: repo.path });
    await rename(notes.path, `${notes.path}-moved`);
    const outcome = await status(cfg);
    expect(outcome).toMatchObject({ verdict: "failed", reason: "source-missing" });
    await rename(`${notes.path}-moved`, notes.path);
  });

  it("reports failed / source-missing when a linked original is deleted", async () => {
    const cfg = config();
    await runSync(cfg, { repoRoot: repo.path });
    await rm(notes.resolve("guides/setup.md"));
    const outcome = await status(cfg);
    expect(outcome).toMatchObject({ verdict: "failed", reason: "source-missing" });
    if (outcome?.verdict === "failed") expect(outcome.error).toContain("guides/setup.md");
  });

  it("reports failed without a reason when a ${VAR} is unset", async () => {
    const cfg = config({ path: "${NOTES_HOME}" });
    await runSync(cfg, { repoRoot: repo.path, env: { NOTES_HOME: notes.path } });
    const outcome = await status(cfg, {});
    expect(outcome).toMatchObject({ verdict: "failed" });
    if (outcome?.verdict === "failed") {
      expect(outcome.reason).toBeUndefined();
      expect(outcome.error).toMatch(/NOTES_HOME/);
    }
  });

  it("reports manifest-changed when the directory's manifest surface changes", async () => {
    await put("maester.yaml", "schemaVersion: 1\ndocuments:\n  - path: README.md\n");
    const cfg = {
      schemaVersion: 1,
      sources: [{ name: "notes", path: notesRel }],
    } as CitadelConfig;
    await runSync(cfg, { repoRoot: repo.path });
    expect((await status(cfg))?.verdict).toBe("up-to-date");
    await put(
      "maester.yaml",
      "schemaVersion: 1\ndocuments:\n  - path: README.md\n  - path: guides/*.md\n",
    );
    const outcome = await status(cfg);
    expect(outcome?.verdict).toBe("behind");
    if (outcome?.verdict === "behind") expect(outcome.reasons).toContain("manifest-changed");
  });
});
