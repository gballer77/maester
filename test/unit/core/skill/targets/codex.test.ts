import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexTarget } from "../../../../../src/core/skill/targets/codex.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-skill-codex-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const input = (overrides: Partial<{ version: string; baseDir: string }> = {}) => ({
  repoRoot,
  skillVersion: overrides.version ?? "1.0.0",
  citadelBaseDir: overrides.baseDir ?? "citadel",
});

describe("codexTarget.write", () => {
  const skillPath = ".agents/skills/grand-maester/SKILL.md";

  it("installs SKILL.md at the Codex skills directory with implicit-invocation frontmatter", async () => {
    const outcome = await codexTarget.write(input());
    expect(outcome.action).toBe("installed");

    const text = await fs.readFile(path.join(repoRoot, skillPath), "utf8");
    expect(text.startsWith("---")).toBe(true);
    expect(text).toContain("name: grand-maester");
    expect(text).toContain("description:");
    expect(text).toContain("<!-- maester:skill:begin v=1.0.0 -->");
    expect(text).toContain("citadel/"); // baseDir substitution
  });

  it("does not write a root AGENTS.md", async () => {
    await codexTarget.write(input());
    let exists = true;
    try {
      await fs.access(path.join(repoRoot, "AGENTS.md"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it("is idempotent on a second identical write", async () => {
    await codexTarget.write(input());
    const first = await fs.readFile(path.join(repoRoot, skillPath), "utf8");
    const outcome = await codexTarget.write(input());
    expect(outcome.action).toBe("unchanged");
    const second = await fs.readFile(path.join(repoRoot, skillPath), "utf8");
    expect(second).toBe(first);
  });

  it("preserves user-added content outside the managed region on upgrade", async () => {
    await codexTarget.write(input({ version: "0.1.0" }));
    const filePath = path.join(repoRoot, skillPath);
    const baseText = await fs.readFile(filePath, "utf8");
    const augmented = `${baseText}\n\n## User notes\n\nLocal edits the user added.\n`;
    await fs.writeFile(filePath, augmented, "utf8");

    const outcome = await codexTarget.write(input({ version: "0.2.0" }));
    expect(outcome.action).toBe("upgraded");
    const result = await fs.readFile(filePath, "utf8");
    expect(result).toContain("Local edits the user added.");
    expect(result).toContain("<!-- maester:skill:begin v=0.2.0 -->");
  });

  it("upgrades the version marker on a SKILL.md from an older release", async () => {
    await codexTarget.write(input({ version: "0.1.0" }));
    const outcome = await codexTarget.write(input({ version: "0.2.0" }));
    expect(outcome.action).toBe("upgraded");
    const text = await fs.readFile(path.join(repoRoot, skillPath), "utf8");
    expect(text).toContain("<!-- maester:skill:begin v=0.2.0 -->");
    expect(text).not.toContain("<!-- maester:skill:begin v=0.1.0 -->");
  });

  it("substitutes the citadel base directory", async () => {
    await codexTarget.write(input({ baseDir: "vendor/docs" }));
    const text = await fs.readFile(path.join(repoRoot, skillPath), "utf8");
    expect(text).toContain("vendor/docs/");
    expect(text).not.toMatch(/\{\{baseDir\}\}/);
  });

  it("reads back the installed version from SKILL.md", async () => {
    expect(await codexTarget.readInstalledVersion(repoRoot)).toBeUndefined();
    await codexTarget.write(input({ version: "3.4.5" }));
    expect(await codexTarget.readInstalledVersion(repoRoot)).toBe("3.4.5");
  });

  it("returns undefined when SKILL.md exists but has no managed region", async () => {
    const filePath = path.join(repoRoot, skillPath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "---\nname: grand-maester\n---\n\nfreeform\n", "utf8");
    expect(await codexTarget.readInstalledVersion(repoRoot)).toBeUndefined();
  });
});
