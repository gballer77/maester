import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cursorTarget } from "../../../../../src/core/skill/targets/cursor.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-skill-cursor-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const input = (overrides: Partial<{ version: string; baseDir: string }> = {}) => ({
  repoRoot,
  skillVersion: overrides.version ?? "1.0.0",
  citadelBaseDir: overrides.baseDir ?? "citadel",
});

describe("cursorTarget.write", () => {
  const rulePath = ".cursor/rules/grand-maester.mdc";

  it("creates the rule file with MDC frontmatter and managed region", async () => {
    const outcome = await cursorTarget.write(input());
    expect(outcome.action).toBe("installed");
    const text = await fs.readFile(path.join(repoRoot, rulePath), "utf8");
    expect(text.startsWith("---")).toBe(true);
    expect(text).toContain("description:");
    expect(text).toContain('globs: ["citadel/**/*"]');
    expect(text).toContain("<!-- maester:skill:begin v=1.0.0 -->");
  });

  it("is idempotent on a second identical write", async () => {
    await cursorTarget.write(input());
    const first = await fs.readFile(path.join(repoRoot, rulePath), "utf8");
    const outcome = await cursorTarget.write(input());
    expect(outcome.action).toBe("unchanged");
    const second = await fs.readFile(path.join(repoRoot, rulePath), "utf8");
    expect(second).toBe(first);
  });

  it("reads back the installed version", async () => {
    expect(await cursorTarget.readInstalledVersion(repoRoot)).toBeUndefined();
    await cursorTarget.write(input({ version: "9.9.9" }));
    expect(await cursorTarget.readInstalledVersion(repoRoot)).toBe("9.9.9");
  });

  it("upgrades the version marker on a rule from an older release", async () => {
    await cursorTarget.write(input({ version: "0.1.0" }));
    const outcome = await cursorTarget.write(input({ version: "0.2.0" }));
    expect(outcome.action).toBe("upgraded");
    const text = await fs.readFile(path.join(repoRoot, rulePath), "utf8");
    expect(text).toContain("v=0.2.0");
  });
});
