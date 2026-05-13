import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSync } from "../../src/core/sync/runner.js";
import type { CitadelConfig } from "../../src/schemas/citadel.js";
import { type FixtureRemote, createBareRemote } from "../helpers/fixture-remote.js";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

let repo: TempRepo;
let remotes: FixtureRemote[] = [];

beforeEach(async () => {
  repo = await makeTmpRepo();
  remotes = [];
});

afterEach(async () => {
  await repo.cleanup();
  for (const r of remotes) await r.cleanup();
});

async function newRemote(files: { path: string; contents: string }[]): Promise<FixtureRemote> {
  const remote = await createBareRemote({ files });
  remotes.push(remote);
  return remote;
}

async function read(dest: string, rel: string): Promise<string> {
  return readFile(resolve(dest, rel), "utf8");
}

describe("document state tagging — end to end", () => {
  it("manifest-driven: applies state from PublishedDocument.state to materialized files", async () => {
    const remote = await newRemote([
      {
        path: "maester.yaml",
        contents:
          "schemaVersion: 1\ndocuments:\n" +
          "  - path: README.md\n    state: canon\n" +
          "  - path: docs/wip.md\n    state: draft\n",
      },
      { path: "README.md", contents: "# readme\n" },
      { path: "docs/wip.md", contents: "# wip\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };

    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);

    const dest = repo.resolve("citadel/alpha");
    expect(await read(dest, "README.md")).toContain("state: canon");
    expect(await read(dest, "docs/wip.md")).toContain("state: draft");

    const outcome = result.outcomes[0];
    expect(outcome?.stateBreakdown).toEqual({ canon: 1, draft: 1, untagged: 0 });
  }, 30_000);

  it("manifest-driven without per-doc state: every file defaults to draft", async () => {
    const remote = await newRemote([
      {
        path: "maester.yaml",
        contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n  - path: notes.txt\n",
      },
      { path: "README.md", contents: "# readme\n" },
      { path: "notes.txt", contents: "hello\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };

    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);

    const dest = repo.resolve("citadel/alpha");
    expect(await read(dest, "README.md")).toContain("state: draft");
    expect(await read(dest, "notes.txt")).toMatch(/^state: draft\n/);
    expect(result.outcomes[0]?.stateBreakdown).toEqual({ canon: 0, draft: 2, untagged: 0 });
  }, 30_000);

  it("inline state in the source file wins over a manifest-driven rule", async () => {
    const remote = await newRemote([
      {
        path: "maester.yaml",
        contents: "schemaVersion: 1\ndocuments:\n  - path: docs/x.md\n    state: canon\n",
      },
      { path: "docs/x.md", contents: "---\nstate: draft\n---\n\nbody\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };

    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);

    const dest = repo.resolve("citadel/alpha");
    const text = await read(dest, "docs/x.md");
    expect(text).toContain("state: draft");
    expect(text).not.toContain("state: canon");

    const outcome = result.outcomes[0];
    expect(outcome?.stateBreakdown).toEqual({ canon: 0, draft: 1, untagged: 0 });
    expect(outcome?.stateWarnings).toEqual([
      { type: "disagreement", file: "docs/x.md", inline: "draft", rule: "canon" },
    ]);
  }, 30_000);

  it("includes-driven: object-form includes carry their state into materialized files", async () => {
    const remote = await newRemote([
      { path: "docs/intro.md", contents: "# intro\n" },
      { path: "CHANGELOG.md", contents: "# changes\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        {
          name: "alpha",
          url: remote.bareRepoUrl,
          ref: "main",
          includes: [{ path: "docs/**/*.md", state: "canon" }, "CHANGELOG.md"],
        },
      ],
    };

    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);

    const dest = repo.resolve("citadel/alpha");
    expect(await read(dest, "docs/intro.md")).toContain("state: canon");
    expect(await read(dest, "CHANGELOG.md")).toContain("state: draft");
    expect(result.outcomes[0]?.stateBreakdown).toEqual({
      canon: 1,
      draft: 1,
      untagged: 0,
    });
  }, 30_000);

  it("unsupported formats (binary, no extension) are materialized untagged", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: assets/**/*\n" },
      { path: "assets/logo.svg", contents: "<svg/>" },
      { path: "assets/data.bin", contents: "raw bytes" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };

    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);

    const dest = repo.resolve("citadel/alpha");
    expect(await read(dest, "assets/logo.svg")).toBe("<svg/>");
    expect(await read(dest, "assets/data.bin")).toBe("raw bytes");
    expect(result.outcomes[0]?.stateBreakdown).toEqual({ canon: 0, draft: 0, untagged: 2 });
  }, 30_000);

  it("an invalid inline state value surfaces a warning and falls through to rule", async () => {
    const remote = await newRemote([
      {
        path: "maester.yaml",
        contents: "schemaVersion: 1\ndocuments:\n  - path: docs/x.md\n    state: canon\n",
      },
      { path: "docs/x.md", contents: "---\nstate: published\n---\n\nbody\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };

    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);

    const dest = repo.resolve("citadel/alpha");
    expect(await read(dest, "docs/x.md")).toContain("state: canon");
    expect(result.outcomes[0]?.stateBreakdown).toEqual({
      canon: 1,
      draft: 0,
      untagged: 0,
    });
    expect(result.outcomes[0]?.stateWarnings).toEqual([
      { type: "bad-inline-state", file: "docs/x.md", raw: "published" },
    ]);
  }, 30_000);
});
