import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filterSetsEqual, runStatus } from "../../../../src/core/status/runner.js";
import type { CitadelConfig } from "../../../../src/schemas/citadel.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;

beforeEach(async () => {
  repo = await makeTmpRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

describe("filterSetsEqual", () => {
  it("returns true for the same patterns in different orders", () => {
    expect(filterSetsEqual(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("returns true when one side has duplicates that collapse to the same set", () => {
    expect(filterSetsEqual(["a", "b"], ["b", "a", "a"])).toBe(true);
  });

  it("returns false when the sets differ", () => {
    expect(filterSetsEqual(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("returns true for two empty arrays", () => {
    expect(filterSetsEqual([], [])).toBe(true);
  });
});

describe("runStatus — short-circuit paths (no network)", () => {
  it("reports every never-synced source without resolving auth or hitting the network", async () => {
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        { name: "alpha", url: "https://example.invalid/repo.git", ref: "main" },
        { name: "beta", url: "https://example.invalid/repo2.git", ref: "main" },
      ],
    };
    const result = await runStatus(config, { repoRoot: repo.path });
    expect(result.outcomes).toHaveLength(2);
    for (const outcome of result.outcomes) {
      expect(outcome.verdict).toBe("behind");
      if (outcome.verdict === "behind") {
        expect(outcome.reasons).toEqual(["never-synced"]);
      }
    }
    expect(result.counts).toEqual({ upToDate: 0, behind: 2, failed: 0 });
  });

  it("scopes the run to named sources", async () => {
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [
        { name: "alpha", url: "https://example.invalid/a.git", ref: "main" },
        { name: "beta", url: "https://example.invalid/b.git", ref: "main" },
      ],
    };
    const result = await runStatus(config, { repoRoot: repo.path, scope: ["beta"] });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.name).toBe("beta");
  });

  it("throws UNKNOWN_SOURCE before any per-source work when scope contains an unknown name", async () => {
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [{ name: "alpha", url: "https://example.invalid/a.git", ref: "main" }],
    };
    await expect(runStatus(config, { repoRoot: repo.path, scope: ["nope"] })).rejects.toThrow(
      /Unknown source 'nope'/,
    );
  });

  it("returns zero counts and an empty outcomes array when no sources are configured", async () => {
    const config: CitadelConfig = { schemaVersion: 1, sources: [] };
    const result = await runStatus(config, { repoRoot: repo.path });
    expect(result.outcomes).toEqual([]);
    expect(result.counts).toEqual({ upToDate: 0, behind: 0, failed: 0 });
  });
});
