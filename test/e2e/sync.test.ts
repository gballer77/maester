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
      { path: "README.md", contents: "# alpha\n" },
      { path: "docs/x.md", contents: "x\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 2,
      maesters: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
      ravens: [],
    };

    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.failed).toBe(0);
    expect(result.outcomes[0]?.status).toBe("added");

    const dest = repo.resolve("citadel/alpha");
    expect(existsSync(resolve(dest, "README.md"))).toBe(true);
    expect(existsSync(resolve(dest, PROVENANCE_FILENAME))).toBe(true);
    const marker = JSON.parse(await readFile(resolve(dest, PROVENANCE_FILENAME), "utf8"));
    expect(marker.maesterName).toBe("alpha");
  }, 30_000);

  it("reports 'unchanged' on a no-op re-sync", async () => {
    const remote = await newRemote([{ path: "README.md", contents: "# alpha\n" }]);
    const config: CitadelConfig = {
      schemaVersion: 2,
      maesters: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
      ravens: [],
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
      schemaVersion: 2,
      maesters: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
      ravens: [],
    };
    const result = await runSync(config, { repoRoot: repo.path });
    expect(result.outcomes[0]?.filterMode).toBe("manifest");
    const dest = repo.resolve("citadel/alpha");
    expect(existsSync(resolve(dest, "README.md"))).toBe(true);
    expect(existsSync(resolve(dest, "private/secret.md"))).toBe(false);
  }, 30_000);

  it("marks a single source failed without affecting other sources", async () => {
    const goodRemote = await newRemote([{ path: "README.md", contents: "ok\n" }]);
    const config: CitadelConfig = {
      schemaVersion: 2,
      maesters: [
        { name: "good", url: goodRemote.bareRepoUrl, ref: "main" },
        { name: "bad", url: goodRemote.bareRepoUrl, ref: "branch-that-does-not-exist" },
      ],
      ravens: [],
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
      schemaVersion: 2,
      maesters: [
        {
          name: "with-auth",
          url: remote.bareRepoUrl,
          ref: "main",
          auth: { type: "token", envVar: "MAESTER_TEST_TOKEN_THAT_IS_UNSET" },
        },
      ],
      ravens: [],
    };
    const { MAESTER_TEST_TOKEN_THAT_IS_UNSET: _ignored, ...envWithoutToken } = process.env;
    const result = await runSync(config, { repoRoot: repo.path, env: envWithoutToken });
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]?.error).toMatch(/MAESTER_TEST_TOKEN_THAT_IS_UNSET/);
  }, 30_000);

  it("scopes to a subset when scope is provided", async () => {
    const a = await newRemote([{ path: "a.md", contents: "a\n" }]);
    const b = await newRemote([{ path: "b.md", contents: "b\n" }]);
    const config: CitadelConfig = {
      schemaVersion: 2,
      maesters: [
        { name: "alpha", url: a.bareRepoUrl, ref: "main" },
        { name: "beta", url: b.bareRepoUrl, ref: "main" },
      ],
      ravens: [],
    };
    const result = await runSync(config, { repoRoot: repo.path, scope: ["beta"] });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.name).toBe("beta");
  }, 30_000);
});
