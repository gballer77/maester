import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimePreread, runtimeStatusSummary } from "../../../../src/core/skill/runtime.js";
import type { StatusOptions, StatusResult } from "../../../../src/core/status/runner.js";
import type { CitadelConfig } from "../../../../src/schemas/citadel.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-skill-runtime-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const writeCitadel = async (baseDir = "citadel"): Promise<void> => {
  const yaml = `schemaVersion: 1\nbaseDir: ${baseDir}\nsources:\n  - name: docs\n    url: https://example.com/docs.git\n`;
  await fs.writeFile(path.join(repoRoot, "citadel.yaml"), yaml, "utf8");
};

const envelope = (overrides: Partial<{ filePath: string; cwd: string }> = {}) =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    cwd: overrides.cwd ?? repoRoot,
    tool_input: { file_path: overrides.filePath ?? "" },
  });

const fakeRunStatus = (result: StatusResult) =>
  vi.fn(async (_config: CitadelConfig, _opts: StatusOptions) => result);

describe("runtimePreread", () => {
  it("returns empty when stdin is empty", async () => {
    expect(await runtimePreread("", { repoRoot })).toBe("");
  });

  it("returns empty when no citadel config exists", async () => {
    const stub = vi.fn();
    const out = await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "x.md") }),
      { repoRoot, runStatus: stub },
    );
    expect(out).toBe("");
    expect(stub).not.toHaveBeenCalled();
  });

  it("returns empty when the targeted path is outside the citadel baseDir", async () => {
    await writeCitadel();
    const stub = vi.fn();
    const out = await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "src", "main.ts") }),
      { repoRoot, runStatus: stub },
    );
    expect(out).toBe("");
    expect(stub).not.toHaveBeenCalled();
  });

  it("returns empty hook response when status is up-to-date", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [{ name: "docs", verdict: "up-to-date", commitSha: "abc" }],
      counts: { upToDate: 1, behind: 0, failed: 0 },
    });
    const out = await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "readme.md") }),
      { repoRoot, runStatus: runner },
    );
    expect(out).toBe("");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("emits additionalContext when behind", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [
        {
          name: "docs",
          verdict: "behind",
          reasons: ["remote-ref-advanced"],
          commitSha: "old",
          resolvedSha: "new",
        },
      ],
      counts: { upToDate: 0, behind: 1, failed: 0 },
    });
    const out = await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "readme.md") }),
      { repoRoot, runStatus: runner },
    );
    expect(out.length).toBeGreaterThan(0);
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("behind");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("maester sync");
  });

  it("emits additionalContext when failed (no blocking)", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [{ name: "docs", verdict: "failed", error: "ENETDOWN" }],
      counts: { upToDate: 0, behind: 0, failed: 1 },
    });
    const out = await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "readme.md") }),
      { repoRoot, runStatus: runner },
    );
    const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
    expect(parsed.hookSpecificOutput.additionalContext).toContain("failed");
  });

  it("reuses the cached verdict within the debounce TTL", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [{ name: "docs", verdict: "up-to-date", commitSha: "abc" }],
      counts: { upToDate: 1, behind: 0, failed: 0 },
    });
    let now = 1_000_000;
    await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "readme.md") }),
      { repoRoot, runStatus: runner, now: () => now },
    );
    expect(runner).toHaveBeenCalledTimes(1);
    // 60 seconds later — within default 300s TTL
    now += 60_000;
    await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "another.md") }),
      { repoRoot, runStatus: runner, now: () => now },
    );
    expect(runner).toHaveBeenCalledTimes(1); // still 1 — cache hit
  });

  it("re-checks after the cache TTL expires", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [{ name: "docs", verdict: "up-to-date", commitSha: "abc" }],
      counts: { upToDate: 1, behind: 0, failed: 0 },
    });
    let now = 2_000_000;
    await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "readme.md") }),
      { repoRoot, runStatus: runner, now: () => now },
    );
    // Past default 300s
    now += 301_000;
    await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "readme.md") }),
      { repoRoot, runStatus: runner, now: () => now },
    );
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("writes the cache atomically under .maester/.skill-cache.json", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [{ name: "docs", verdict: "up-to-date", commitSha: "abc" }],
      counts: { upToDate: 1, behind: 0, failed: 0 },
    });
    await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "readme.md") }),
      { repoRoot, runStatus: runner },
    );
    const cachePath = path.join(repoRoot, ".maester/.skill-cache.json");
    const raw = await fs.readFile(cachePath, "utf8");
    const cached = JSON.parse(raw) as Record<string, unknown>;
    expect(cached.verdict).toBe("up-to-date");
    expect(typeof cached.ts).toBe("number");
  });

  it("honors MAESTER_SKILL_STATUS_TTL override", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [{ name: "docs", verdict: "up-to-date", commitSha: "abc" }],
      counts: { upToDate: 1, behind: 0, failed: 0 },
    });
    let now = 10_000_000;
    const env = { MAESTER_SKILL_STATUS_TTL: "10" };
    await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "readme.md") }),
      { repoRoot, env, runStatus: runner, now: () => now },
    );
    expect(runner).toHaveBeenCalledTimes(1);
    now += 11_000; // 11s — past the 10s TTL
    await runtimePreread(
      envelope({ filePath: path.join(repoRoot, "citadel", "docs", "readme.md") }),
      { repoRoot, env, runStatus: runner, now: () => now },
    );
    expect(runner).toHaveBeenCalledTimes(2);
  });
});

describe("runtimeStatusSummary", () => {
  it("returns exit 2 when no citadel config exists", async () => {
    const result = await runtimeStatusSummary({ repoRoot });
    expect(result.exitCode).toBe(2);
  });

  it("returns exit 0 with an up-to-date summary", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [{ name: "docs", verdict: "up-to-date", commitSha: "abc" }],
      counts: { upToDate: 1, behind: 0, failed: 0 },
    });
    const result = await runtimeStatusSummary({ repoRoot, runStatus: runner });
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("up to date");
  });

  it("returns exit 1 when at least one source is behind", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [
        {
          name: "docs",
          verdict: "behind",
          reasons: ["remote-ref-advanced"],
        },
      ],
      counts: { upToDate: 0, behind: 1, failed: 0 },
    });
    const result = await runtimeStatusSummary({ repoRoot, runStatus: runner });
    expect(result.exitCode).toBe(1);
  });

  it("returns exit 2 when at least one source failed", async () => {
    await writeCitadel();
    const runner = fakeRunStatus({
      outcomes: [{ name: "docs", verdict: "failed", error: "boom" }],
      counts: { upToDate: 0, behind: 0, failed: 1 },
    });
    const result = await runtimeStatusSummary({ repoRoot, runStatus: runner });
    expect(result.exitCode).toBe(2);
  });
});
