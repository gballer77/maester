import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROVENANCE_FILENAME } from "../../src/core/sync/provenance.js";
import { runSync } from "../../src/core/sync/runner.js";
import type { CitadelConfig, Source } from "../../src/schemas/citadel.js";
import {
  type FixtureRemote,
  bumpSubmodule,
  createBareRemote,
  createBareRemoteWithSubmodules,
} from "../helpers/fixture-remote.js";
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

async function remote(files: { path: string; contents: string }[]): Promise<FixtureRemote> {
  const r = await createBareRemote({ files });
  remotes.push(r);
  return r;
}

async function umbrella(
  files: { path: string; contents: string }[],
  submodules: { path: string; remote: FixtureRemote }[],
): Promise<FixtureRemote> {
  const r = await createBareRemoteWithSubmodules({ files, submodules });
  remotes.push(r);
  return r;
}

function config(source: Omit<Source, "name">): CitadelConfig {
  return { schemaVersion: 1, sources: [{ name: "platform", ref: "main", ...source }] };
}

const billingFiles = [
  { path: "docs/billing.md", contents: "# billing\n" },
  { path: "src/code.ts", contents: "export {};\n" },
  {
    path: "maester.yaml",
    contents: "schemaVersion: 1\ndocuments:\n  - path: src/**\n",
  },
];

describe("sync with git submodules", () => {
  it("surfaces submodule files a manifest publishes, and nothing else from the submodule", async () => {
    const billing = await remote(billingFiles);
    const auth = await remote([{ path: "docs/auth.md", contents: "# auth\n" }]);
    const platform = await umbrella(
      [
        { path: "docs/p.md", contents: "# p\n" },
        {
          path: "maester.yaml",
          contents:
            "schemaVersion: 1\ndocuments:\n  - path: docs/**\n  - path: services/billing/docs/**\n",
        },
      ],
      [
        { path: "services/billing", remote: billing },
        { path: "services/auth", remote: auth },
      ],
    );

    const result = await runSync(config({ url: platform.bareRepoUrl }), { repoRoot: repo.path });
    const outcome = result.outcomes[0];
    expect(outcome?.status).toBe("added");
    expect(outcome?.warnings).toEqual([]);
    expect(outcome?.submodules?.map((s) => s.path)).toEqual(["services/billing"]);

    const dest = repo.resolve("citadel/platform");
    expect(existsSync(resolve(dest, "docs/p.md"))).toBe(true);
    expect(existsSync(resolve(dest, "services/billing/docs/billing.md"))).toBe(true);
    // The submodule's own maester.yaml publishes src/** — the parent governs, so it's ignored.
    expect(existsSync(resolve(dest, "services/billing/src/code.ts"))).toBe(false);
    expect(existsSync(resolve(dest, "services/billing/.git"))).toBe(false);
    // Not reached by any pattern → never fetched.
    expect(existsSync(repo.resolve(".maester/cache/platform/services/auth/.git"))).toBe(false);

    const marker = JSON.parse(await readFile(resolve(dest, PROVENANCE_FILENAME), "utf8"));
    expect(marker.submodules).toEqual(outcome?.submodules);
  }, 60_000);

  it("follows includes into nested submodules", async () => {
    const leaf = await remote([{ path: "spec.md", contents: "leaf\n" }]);
    const mid = await umbrella(
      [{ path: "README.md", contents: "mid\n" }],
      [{ path: "leaf", remote: leaf }],
    );
    const platform = await umbrella(
      [{ path: "README.md", contents: "top\n" }],
      [{ path: "vendor-spec", remote: mid }],
    );

    const result = await runSync(
      config({ url: platform.bareRepoUrl, includes: ["README.md", "vendor-spec/leaf/*.md"] }),
      { repoRoot: repo.path },
    );
    expect(result.outcomes[0]?.warnings).toEqual([]);
    const dest = repo.resolve("citadel/platform");
    // Copy mode tags state inline, so compare the body only.
    expect(await readFile(resolve(dest, "vendor-spec/leaf/spec.md"), "utf8")).toContain("leaf\n");
    expect(existsSync(resolve(dest, "vendor-spec/README.md"))).toBe(false);
  }, 60_000);

  it("links submodule content in whole-repository mode and skips excluded directories", async () => {
    const lib = await remote([{ path: "guide.md", contents: "guide\n" }]);
    const vendored = await remote([{ path: "v.md", contents: "v\n" }]);
    const platform = await umbrella(
      [{ path: "README.md", contents: "top\n" }],
      [
        { path: "libs/lib", remote: lib },
        { path: "vendor/thing", remote: vendored },
      ],
    );

    const result = await runSync(config({ url: platform.bareRepoUrl }), { repoRoot: repo.path });
    const outcome = result.outcomes[0];
    expect(outcome?.filterMode).toBe("whole-repository");
    expect(outcome?.submodules?.map((s) => s.path)).toEqual(["libs/lib"]);
    const linked = repo.resolve("citadel/platform/libs/lib/guide.md");
    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
    expect(await readFile(linked, "utf8")).toBe("guide\n");
    expect(existsSync(repo.resolve("citadel/platform/vendor/thing/v.md"))).toBe(false);
  }, 60_000);

  it("syncs the rest of the source when a submodule is unreachable", async () => {
    const gone = await remote([{ path: "docs/x.md", contents: "x\n" }]);
    const platform = await umbrella(
      [{ path: "docs/p.md", contents: "p\n" }],
      [{ path: "gone", remote: gone }],
    );
    remotes = remotes.filter((r) => r !== gone);
    await gone.cleanup();

    const result = await runSync(
      config({ url: platform.bareRepoUrl, includes: ["docs/**", "gone/docs/**"] }),
      { repoRoot: repo.path },
    );
    expect(result.failed).toBe(0);
    const outcome = result.outcomes[0];
    expect(outcome?.status).toBe("added");
    expect(outcome?.warnings).toMatchObject([{ type: "submodule-unreachable", path: "gone" }]);
    expect(existsSync(repo.resolve("citadel/platform/docs/p.md"))).toBe(true);
  }, 60_000);

  it("updates when the parent re-pins a submodule, and is unchanged otherwise", async () => {
    const billing = await remote([{ path: "docs/b.md", contents: "v1\n" }]);
    const platform = await umbrella(
      [{ path: "README.md", contents: "top\n" }],
      [{ path: "billing", remote: billing }],
    );
    const cfg = config({ url: platform.bareRepoUrl, includes: ["billing/docs/**"] });

    await runSync(cfg, { repoRoot: repo.path });
    const again = await runSync(cfg, { repoRoot: repo.path });
    expect(again.outcomes[0]?.status).toBe("unchanged");

    await billing.pushCommit({ files: [{ path: "docs/b.md", contents: "v2\n" }] });
    await bumpSubmodule(platform, "billing");
    const bumped = await runSync(cfg, { repoRoot: repo.path });
    expect(bumped.outcomes[0]?.status).toBe("updated");
    expect(await readFile(repo.resolve("citadel/platform/billing/docs/b.md"), "utf8")).toContain(
      "v2\n",
    );
  }, 90_000);

  it("removes submodule content when the parent drops the submodule", async () => {
    const billing = await remote([{ path: "docs/b.md", contents: "b\n" }]);
    const platform = await umbrella(
      [{ path: "README.md", contents: "top\n" }],
      [{ path: "billing", remote: billing }],
    );
    const cfg = config({ url: platform.bareRepoUrl, includes: ["README.md", "billing/**"] });
    await runSync(cfg, { repoRoot: repo.path });
    expect(existsSync(repo.resolve("citadel/platform/billing/docs/b.md"))).toBe(true);

    await platform.pushCommit({ remove: ["billing"] });
    const result = await runSync(cfg, { repoRoot: repo.path });
    expect(result.outcomes[0]?.status).toBe("updated");
    expect(existsSync(repo.resolve("citadel/platform/billing/docs/b.md"))).toBe(false);
    expect(existsSync(repo.resolve("citadel/platform/README.md"))).toBe(true);
  }, 90_000);

  it("fetches nothing with submodules: false and says what was skipped", async () => {
    const billing = await remote([{ path: "docs/b.md", contents: "b\n" }]);
    const platform = await umbrella(
      [{ path: "README.md", contents: "top\n" }],
      [{ path: "billing", remote: billing }],
    );
    const cfg = config({
      url: platform.bareRepoUrl,
      includes: ["README.md", "billing/docs/**"],
      submodules: false,
    });
    const result = await runSync(cfg, { repoRoot: repo.path });
    const outcome = result.outcomes[0];
    expect(outcome?.submodules).toBeUndefined();
    expect(outcome?.warnings).toEqual([
      { type: "submodules-disabled", name: "platform", paths: ["billing"] },
    ]);
    expect(existsSync(repo.resolve(".maester/cache/platform/billing/.git"))).toBe(false);
    expect(existsSync(repo.resolve("citadel/platform/README.md"))).toBe(true);
  }, 60_000);
});
