import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROVENANCE_FILENAME } from "../../src/core/sync/provenance.js";
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

describe("runSync against fixture bare repos", () => {
  it("syncs a single source on first run and writes the provenance marker", async () => {
    const remote = await newRemote([
      {
        path: "maester.yaml",
        contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n  - path: docs/x.md\n",
      },
      { path: "README.md", contents: "# alpha\n" },
      { path: "docs/x.md", contents: "x\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };

    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);
    expect(result.outcomes[0]?.status).toBe("added");

    const dest = repo.resolve("citadel/alpha");
    expect(existsSync(resolve(dest, "README.md"))).toBe(true);
    expect(existsSync(resolve(dest, PROVENANCE_FILENAME))).toBe(true);
    const marker = JSON.parse(await readFile(resolve(dest, PROVENANCE_FILENAME), "utf8"));
    expect(marker.sourceName).toBe("alpha");
  }, 30_000);

  it("reports 'unchanged' on a no-op re-sync", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# alpha\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    await runSync(config, { repoRoot: repo.path });
    const second = await runSync(config, { repoRoot: repo.path });
    expect(second.outcomes[0]?.status).toBe("unchanged");
  }, 30_000);

  it("respects the published manifest when present (sparse subset)", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# included\n" },
      { path: "private/secret.md", contents: "do not publish\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);
    const dest = repo.resolve("citadel/alpha");
    expect(existsSync(resolve(dest, "README.md"))).toBe(true);
    expect(existsSync(resolve(dest, "private/secret.md"))).toBe(false);
  }, 30_000);

  it("marks a single source failed without affecting other sources", async () => {
    const goodRemote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "ok\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        { name: "good", url: goodRemote.bareRepoUrl, ref: "main" },
        { name: "bad", url: goodRemote.bareRepoUrl, ref: "branch-that-does-not-exist" },
      ],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(1);
    const byName = new Map(result.outcomes.map((o) => [o.name, o]));
    expect(byName.get("good")?.status).toBe("added");
    expect(byName.get("bad")?.status).toBe("failed");
    expect(byName.get("bad")?.error).toMatch(/not found|branch-that-does-not-exist/i);
  }, 30_000);

  it("marks a source failed when a referenced env var is missing", async () => {
    const remote = await newRemote([{ path: "README.md", contents: "x\n" }]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        {
          name: "with-auth",
          url: remote.bareRepoUrl,
          ref: "main",
          auth: { type: "token", envVar: "MAESTER_TEST_TOKEN_THAT_IS_UNSET" },
        },
      ],
    };
    const { MAESTER_TEST_TOKEN_THAT_IS_UNSET: _ignored, ...envWithoutToken } = process.env;
    const result = await runSync(config, { repoRoot: repo.path, env: envWithoutToken });
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]?.error).toMatch(/MAESTER_TEST_TOKEN_THAT_IS_UNSET/);
  }, 30_000);

  it("scopes to a subset when scope is provided", async () => {
    const a = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: a.md\n" },
      { path: "a.md", contents: "a\n" },
    ]);
    const b = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: b.md\n" },
      { path: "b.md", contents: "b\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        { name: "alpha", url: a.bareRepoUrl, ref: "main" },
        { name: "beta", url: b.bareRepoUrl, ref: "main" },
      ],
    };
    const result = await runSync(config, { repoRoot: repo.path, scope: ["beta"] });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.name).toBe("beta");
  }, 30_000);

  it("fetches an includes-driven source and surfaces only the declared includes", async () => {
    const remote = await newRemote([
      { path: "README.md", contents: "# vendor\n" },
      { path: "docs/intro.md", contents: "intro\n" },
      { path: "private/secret.md", contents: "do not surface\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        {
          name: "vendor",
          url: remote.bareRepoUrl,
          ref: "main",
          includes: ["docs/**/*.md", "README.md"],
        },
      ],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);
    const outcome = result.outcomes[0];
    expect(outcome?.status).toBe("added");
    expect(outcome?.warnings).toEqual([]);

    const dest = repo.resolve("citadel/vendor");
    expect(existsSync(resolve(dest, "README.md"))).toBe(true);
    expect(existsSync(resolve(dest, "docs/intro.md"))).toBe(true);
    expect(existsSync(resolve(dest, "private/secret.md"))).toBe(false);

    const marker = JSON.parse(await readFile(resolve(dest, PROVENANCE_FILENAME), "utf8"));
    expect(marker.sourceName).toBe("vendor");
    expect(marker.filterSet).toEqual(["docs/**/*.md", "README.md"]);
  }, 30_000);

  it("emits a no-matches warning when includes resolve to zero files", async () => {
    const remote = await newRemote([{ path: "README.md", contents: "# only readme\n" }]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        {
          name: "drifted",
          url: remote.bareRepoUrl,
          ref: "main",
          includes: ["does/not/exist/*.md"],
        },
      ],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);
    const outcome = result.outcomes[0];
    expect(outcome?.status).toBe("added");
    expect(outcome?.warnings).toHaveLength(1);
    expect(outcome?.warnings[0]).toMatchObject({
      type: "no-matches",
      name: "drifted",
    });
  }, 30_000);

  it("syncs a citadel mixing manifest-driven and includes-driven sources with one command", async () => {
    const manifestRemote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# internal readme\n" },
      { path: "private/secret.md", contents: "hidden by manifest\n" },
    ]);
    const includesRemote = await newRemote([
      { path: "README.md", contents: "# vendor readme\n" },
      { path: "docs/a.md", contents: "doc\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        { name: "internal", url: manifestRemote.bareRepoUrl, ref: "main" },
        {
          name: "vendor",
          url: includesRemote.bareRepoUrl,
          ref: "main",
          includes: ["docs/**/*.md"],
        },
      ],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);
    const byName = new Map(result.outcomes.map((o) => [o.name, o]));
    expect(byName.get("internal")?.status).toBe("added");
    expect(byName.get("vendor")?.status).toBe("added");

    const internalDest = repo.resolve("citadel/internal");
    expect(existsSync(resolve(internalDest, "README.md"))).toBe(true);
    expect(existsSync(resolve(internalDest, "private/secret.md"))).toBe(false);

    const vendorDest = repo.resolve("citadel/vendor");
    expect(existsSync(resolve(vendorDest, "docs/a.md"))).toBe(true);
    expect(existsSync(resolve(vendorDest, "README.md"))).toBe(false);
  }, 60_000);

  it("re-syncs an includes-driven source as unchanged when the remote and includes are stable", async () => {
    const remote = await newRemote([
      { path: "README.md", contents: "# stable\n" },
      { path: "docs/a.md", contents: "a\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        {
          name: "stable",
          url: remote.bareRepoUrl,
          ref: "main",
          includes: ["README.md"],
        },
      ],
    };
    await runSync(config, { repoRoot: repo.path });
    const second = await runSync(config, { repoRoot: repo.path });
    expect(second.outcomes[0]?.status).toBe("unchanged");
  }, 60_000);

  it("writes default destinations under config.baseDir instead of 'citadel/'", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# alpha\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      baseDir: "vendor",
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);
    expect(result.outcomes[0]?.status).toBe("added");
    expect(existsSync(repo.resolve("vendor/alpha/README.md"))).toBe(true);
    expect(existsSync(repo.resolve("citadel/alpha/README.md"))).toBe(false);
    expect(existsSync(repo.resolve("vendor/alpha", PROVENANCE_FILENAME))).toBe(true);
  }, 30_000);

  it("changing baseDir after a previous sync leaves the old directory in place", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# alpha\n" },
    ]);
    const before: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    await runSync(before, { repoRoot: repo.path });
    expect(existsSync(repo.resolve("citadel/alpha/README.md"))).toBe(true);

    const after: CitadelConfig = {
      schemaVersion: 1,
      baseDir: "vendor",
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    const result = await runSync(after, { repoRoot: repo.path });
    expect(result.failed).toBe(0);
    expect(existsSync(repo.resolve("vendor/alpha/README.md"))).toBe(true);
    expect(existsSync(repo.resolve("citadel/alpha/README.md"))).toBe(true);
  }, 30_000);

  it("fails a source when the remote does not publish a maester.yaml and no includes are declared", async () => {
    const remote = await newRemote([{ path: "README.md", contents: "# alpha\n" }]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(1);
    const outcome = result.outcomes[0];
    expect(outcome?.status).toBe("failed");
    expect(outcome?.error).toMatch(/manifest/i);
    expect(existsSync(repo.resolve("citadel/alpha/README.md"))).toBe(false);
  }, 30_000);

  it("fails a source when the published maester.yaml is schema-invalid", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 99\ndocuments: []\n" },
      { path: "README.md", contents: "# alpha\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(1);
    const outcome = result.outcomes[0];
    expect(outcome?.status).toBe("failed");
    expect(outcome?.error).toMatch(/manifest/i);
    expect(existsSync(repo.resolve("citadel/alpha/README.md"))).toBe(false);
  }, 30_000);

  it("baseDir does not override an explicit per-source destination", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# alpha\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      baseDir: "vendor",
      sources: [
        {
          name: "alpha",
          url: remote.bareRepoUrl,
          ref: "main",
          destination: "elsewhere/alpha",
        },
      ],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);
    expect(existsSync(repo.resolve("elsewhere/alpha/README.md"))).toBe(true);
    expect(existsSync(repo.resolve("vendor/alpha/README.md"))).toBe(false);
  }, 30_000);
});
