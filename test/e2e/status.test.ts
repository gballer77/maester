import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStatus } from "../../src/core/status/runner.js";
import { runSync } from "../../src/core/sync/runner.js";
import type { CitadelConfig } from "../../src/schemas/citadel.js";
import { type FixtureRemote, createBareRemote } from "../helpers/fixture-remote.js";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

const execFile = promisify(execFileCb);

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

async function pushNewCommit(
  remote: FixtureRemote,
  files: { path: string; contents: string }[],
): Promise<void> {
  // Open a fresh clone from the bare repo, edit, commit, push.
  const tmp = await makeTmpRepo({ withGit: false, withPackageJson: false });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  await execFile("git", ["clone", "--quiet", remote.bareRepoUrl, tmp.path], { env });
  for (const file of files) {
    await tmp.writeFile(file.path, file.contents);
  }
  await execFile("git", ["-C", tmp.path, "add", "-A"], { env });
  await execFile("git", ["-C", tmp.path, "commit", "-m", "advance", "--quiet"], { env });
  await execFile("git", ["-C", tmp.path, "push", "--quiet"], { env });
  await tmp.cleanup();
}

describe("runStatus against fixture bare repos", () => {
  it("reports a freshly-cloned never-synced citadel as behind/never-synced", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# alpha\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };

    const result = await runStatus(config, { repoRoot: repo.path });

    expect(result.counts).toEqual({ upToDate: 0, behind: 1, failed: 0 });
    expect(result.outcomes[0]?.verdict).toBe("behind");
    if (result.outcomes[0]?.verdict === "behind") {
      expect(result.outcomes[0].reasons).toEqual(["never-synced"]);
    }
  }, 30_000);

  it("reports up-to-date when the remote ref and manifest match the last sync", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# alpha\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    await runSync(config, { repoRoot: repo.path });

    const result = await runStatus(config, { repoRoot: repo.path });

    expect(result.counts).toEqual({ upToDate: 1, behind: 0, failed: 0 });
    expect(result.outcomes[0]?.verdict).toBe("up-to-date");
  }, 60_000);

  it("reports behind/remote-ref-advanced after a new commit lands upstream", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# alpha\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    await runSync(config, { repoRoot: repo.path });
    await pushNewCommit(remote, [{ path: "README.md", contents: "# alpha v2\n" }]);

    const result = await runStatus(config, { repoRoot: repo.path });

    expect(result.counts.behind).toBe(1);
    const outcome = result.outcomes[0];
    expect(outcome?.verdict).toBe("behind");
    if (outcome?.verdict === "behind") {
      expect(outcome.reasons).toContain("remote-ref-advanced");
      expect(outcome.commitSha).toBeTruthy();
      expect(outcome.resolvedSha).toBeTruthy();
      expect(outcome.commitSha).not.toBe(outcome.resolvedSha);
    }
  }, 60_000);

  it("reports behind/manifest-changed when the remote manifest adds a new published path", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# alpha\n" },
      { path: "CHANGELOG.md", contents: "v1\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    await runSync(config, { repoRoot: repo.path });
    await pushNewCommit(remote, [
      {
        path: "maester.yaml",
        contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n  - path: CHANGELOG.md\n",
      },
    ]);

    const result = await runStatus(config, { repoRoot: repo.path });

    const outcome = result.outcomes[0];
    expect(outcome?.verdict).toBe("behind");
    if (outcome?.verdict === "behind") {
      expect(outcome.reasons).toContain("manifest-changed");
    }
  }, 60_000);

  it("treats a cosmetic re-order of the remote manifest as up-to-date", async () => {
    const remote = await newRemote([
      {
        path: "maester.yaml",
        contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n  - path: CHANGELOG.md\n",
      },
      { path: "README.md", contents: "# alpha\n" },
      { path: "CHANGELOG.md", contents: "v1\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: remote.bareRepoUrl, ref: "main" }],
    };
    await runSync(config, { repoRoot: repo.path });
    // Re-order the manifest entries only — the resolved publish surface is identical.
    await pushNewCommit(remote, [
      {
        path: "maester.yaml",
        contents: "schemaVersion: 1\ndocuments:\n  - path: CHANGELOG.md\n  - path: README.md\n",
      },
    ]);

    const result = await runStatus(config, { repoRoot: repo.path });

    const outcome = result.outcomes[0];
    expect(outcome?.verdict).toBe("behind"); // ref still advanced
    if (outcome?.verdict === "behind") {
      // The ONLY reason should be the ref advance, not manifest-changed —
      // even though the textual manifest is different, the resolved set of
      // patterns is identical (set-equality semantics).
      expect(outcome.reasons).toEqual(["remote-ref-advanced"]);
    }
  }, 60_000);

  it("skips the manifest-changed check for includes-driven sources", async () => {
    const remote = await newRemote([
      { path: "README.md", contents: "# alpha\n" },
      { path: "docs/x.md", contents: "x\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        {
          name: "alpha",
          url: remote.bareRepoUrl,
          ref: "main",
          includes: ["README.md", "docs/x.md"],
        },
      ],
    };
    await runSync(config, { repoRoot: repo.path });

    const result = await runStatus(config, { repoRoot: repo.path });

    expect(result.counts.upToDate).toBe(1);
    expect(result.outcomes[0]?.verdict).toBe("up-to-date");
  }, 60_000);

  it("reports failed when a token-auth env var is missing", async () => {
    const remote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "# alpha\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        {
          name: "alpha",
          url: remote.bareRepoUrl,
          ref: "main",
          auth: { type: "token", envVar: "MAESTER_STATUS_TEST_MISSING_TOKEN" },
        },
      ],
    };
    await runSync(config, { repoRoot: repo.path, env: { MAESTER_STATUS_TEST_MISSING_TOKEN: "x" } });

    // Now run status without the env var present — auth resolution should fail.
    const result = await runStatus(config, {
      repoRoot: repo.path,
      env: { ...process.env, MAESTER_STATUS_TEST_MISSING_TOKEN: undefined } as NodeJS.ProcessEnv,
    });

    expect(result.counts.failed).toBe(1);
    const outcome = result.outcomes[0];
    expect(outcome?.verdict).toBe("failed");
    if (outcome?.verdict === "failed") {
      expect(outcome.error).toContain("MAESTER_STATUS_TEST_MISSING_TOKEN");
    }
  }, 60_000);

  it("continues past a failed source and reports correct counts", async () => {
    const goodRemote = await newRemote([
      { path: "maester.yaml", contents: "schemaVersion: 1\ndocuments:\n  - path: README.md\n" },
      { path: "README.md", contents: "ok\n" },
    ]);
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        { name: "good", url: goodRemote.bareRepoUrl, ref: "main" },
        {
          name: "bad",
          url: goodRemote.bareRepoUrl,
          ref: "main",
          auth: { type: "token", envVar: "MAESTER_STATUS_NOPE_TOKEN" },
        },
      ],
    };
    await runSync(config, { repoRoot: repo.path, env: { MAESTER_STATUS_NOPE_TOKEN: "x" } });

    const result = await runStatus(config, {
      repoRoot: repo.path,
      env: { ...process.env, MAESTER_STATUS_NOPE_TOKEN: undefined } as NodeJS.ProcessEnv,
    });

    expect(result.counts).toMatchObject({ failed: 1 });
    expect(result.outcomes).toHaveLength(2);
    const verdicts = result.outcomes.map((o) => o.verdict).sort();
    expect(verdicts).toEqual(["failed", "up-to-date"]);
  }, 60_000);
});
