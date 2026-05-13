import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENTS_MD_ARTIFACT_PATH,
  readAgentsMdInstalledVersion,
  writeAgentsMd,
} from "../../../../../src/core/skill/targets/agents-md-writer.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-skill-agents-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("writeAgentsMd", () => {
  const input = (overrides: Partial<{ version: string; baseDir: string }> = {}) => ({
    repoRoot,
    skillVersion: overrides.version ?? "1.0.0",
    citadelBaseDir: overrides.baseDir ?? "citadel",
  });

  it("creates a fresh AGENTS.md with the managed region", async () => {
    const outcome = await writeAgentsMd(input());
    expect(outcome.action).toBe("installed");
    expect(outcome.installedVersion).toBe("1.0.0");
    const text = await fs.readFile(path.join(repoRoot, AGENTS_MD_ARTIFACT_PATH), "utf8");
    expect(text).toContain("<!-- maester:skill:begin v=1.0.0 -->");
    expect(text).toContain("<!-- maester:skill:end -->");
    expect(text).toContain("citadel/"); // baseDir substitution
  });

  it("is idempotent on a second identical write", async () => {
    await writeAgentsMd(input());
    const first = await fs.readFile(path.join(repoRoot, AGENTS_MD_ARTIFACT_PATH), "utf8");
    const second = await writeAgentsMd(input());
    expect(second.action).toBe("unchanged");
    const text = await fs.readFile(path.join(repoRoot, AGENTS_MD_ARTIFACT_PATH), "utf8");
    expect(text).toBe(first);
  });

  it("preserves user-added content outside the managed region on rewrite", async () => {
    await writeAgentsMd(input({ version: "0.1.0" }));
    const filePath = path.join(repoRoot, AGENTS_MD_ARTIFACT_PATH);
    const userText = await fs.readFile(filePath, "utf8");
    const augmented = `${userText}\n\n## User-added section\n\nMy own rules here.\n`;
    await fs.writeFile(filePath, augmented, "utf8");

    const outcome = await writeAgentsMd(input({ version: "0.2.0" }));
    expect(outcome.action).toBe("upgraded");
    const result = await fs.readFile(filePath, "utf8");
    expect(result).toContain("My own rules here.");
    expect(result).toContain("<!-- maester:skill:begin v=0.2.0 -->");
  });

  it("substitutes the citadel base directory", async () => {
    await writeAgentsMd(input({ baseDir: "vendor/docs" }));
    const text = await fs.readFile(path.join(repoRoot, AGENTS_MD_ARTIFACT_PATH), "utf8");
    expect(text).toContain("vendor/docs/");
    expect(text).not.toMatch(/\{\{baseDir\}\}/);
  });
});

describe("readAgentsMdInstalledVersion", () => {
  it("returns undefined when no AGENTS.md is present", async () => {
    expect(await readAgentsMdInstalledVersion(repoRoot)).toBeUndefined();
  });

  it("returns the embedded version after install", async () => {
    await writeAgentsMd({ repoRoot, skillVersion: "2.5.0", citadelBaseDir: "citadel" });
    expect(await readAgentsMdInstalledVersion(repoRoot)).toBe("2.5.0");
  });

  it("returns undefined when the file exists but has no managed region", async () => {
    await fs.writeFile(path.join(repoRoot, AGENTS_MD_ARTIFACT_PATH), "# AGENTS.md\n", "utf8");
    expect(await readAgentsMdInstalledVersion(repoRoot)).toBeUndefined();
  });
});
