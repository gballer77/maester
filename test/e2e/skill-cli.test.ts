import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

const execFile = promisify(execFileCb);
const REPO_ROOT = resolve(__dirname, "..", "..");
const BIN_PATH = resolve(REPO_ROOT, "bin/maester.mjs");

async function runCli(
  args: string[],
  cwd: string,
  envOverrides: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...envOverrides };
  try {
    const { stdout, stderr } = await execFile("node", [BIN_PATH, ...args], { cwd, env });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

async function writeCitadelYaml(repo: TempRepo, baseDir = "citadel"): Promise<void> {
  const yaml = `schemaVersion: 1\nbaseDir: ${baseDir}\nsources:\n  - name: docs\n    url: https://example.com/docs.git\n`;
  await repo.writeFile("citadel.yaml", yaml);
}

let repo: TempRepo;

beforeEach(async () => {
  repo = await makeTmpRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

describe("CLI: maester skill", () => {
  it("install --target codex agents-md writes SKILL.md and AGENTS.md separately", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(
      ["skill", "install", "--target", "codex", "--target", "agents-md"],
      repo.path,
    );
    expect(result.code).toBe(0);
    expect(await fileExists(repo.resolve(".agents/skills/grand-maester/SKILL.md"))).toBe(true);
    expect(await fileExists(repo.resolve("AGENTS.md"))).toBe(true);
    expect(result.stdout).toContain("Codex CLI");
    expect(result.stdout).toContain("Generic AGENTS.md");
  });

  it("install --target codex writes a Codex SKILL.md without touching AGENTS.md", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["skill", "install", "--target", "codex"], repo.path);
    expect(result.code).toBe(0);
    const skillPath = repo.resolve(".agents/skills/grand-maester/SKILL.md");
    expect(await fileExists(skillPath)).toBe(true);
    const text = await fs.readFile(skillPath, "utf8");
    expect(text).toContain("name: grand-maester");
    expect(text).toContain("description:");
    expect(text).toContain("<!-- maester:skill:begin v=");
    expect(await fileExists(repo.resolve("AGENTS.md"))).toBe(false);
  });

  it("install --target claude-code writes SKILL.md and settings.json maester block", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["skill", "install", "--target", "claude-code"], repo.path);
    expect(result.code).toBe(0);
    expect(await fileExists(repo.resolve(".claude/skills/grand-maester/SKILL.md"))).toBe(true);
    expect(await fileExists(repo.resolve(".claude/settings.json"))).toBe(true);
    const settings = JSON.parse(
      await fs.readFile(repo.resolve(".claude/settings.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(settings.maester).toBeDefined();
  });

  it("install with --json emits NDJSON outcomes and a summary line", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["--json", "skill", "install", "--target", "cursor"], repo.path);
    expect(result.code).toBe(0);
    const lines = result.stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const summary = JSON.parse(lines[lines.length - 1] ?? "") as Record<string, unknown>;
    expect(summary.type).toBe("summary");
    expect(summary.installed).toBe(1);
  });

  it("install outside a citadel exits 2", async () => {
    const result = await runCli(["skill", "install", "--target", "cursor"], repo.path);
    expect(result.code).toBe(2);
    expect(result.stderr.length > 0 || result.stdout.toLowerCase().includes("citadel")).toBe(true);
  });

  it("status reports not-installed on a fresh citadel", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["skill", "status"], repo.path);
    // Nothing installed → exit 2
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("not installed");
  });

  it("status reports up-to-date after install", async () => {
    await writeCitadelYaml(repo);
    await runCli(["skill", "install", "--target", "codex"], repo.path);
    const result = await runCli(["skill", "status"], repo.path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("up to date");
  });

  it("upgrade --check exits 1 when an installed target is outdated", async () => {
    await writeCitadelYaml(repo);
    // Plant a stale AGENTS.md to simulate an old install
    await repo.writeFile(
      "AGENTS.md",
      "# AGENTS.md\n\n<!-- maester:skill:begin v=0.0.1 -->\nold body\n<!-- maester:skill:end -->\n",
    );
    const result = await runCli(["skill", "upgrade", "--check"], repo.path);
    expect(result.code).toBe(1);
    // --check does not modify the file
    const after = await fs.readFile(repo.resolve("AGENTS.md"), "utf8");
    expect(after).toContain("v=0.0.1");
  });

  it("upgrade refreshes outdated installed targets in place", async () => {
    await writeCitadelYaml(repo);
    await repo.writeFile(
      "AGENTS.md",
      "# AGENTS.md\n\n<!-- maester:skill:begin v=0.0.1 -->\nold body\n<!-- maester:skill:end -->\n",
    );
    const result = await runCli(["skill", "upgrade"], repo.path);
    expect(result.code).toBe(0);
    const after = await fs.readFile(repo.resolve("AGENTS.md"), "utf8");
    expect(after).not.toContain("v=0.0.1");
  });

  it("install rejects unknown target id with non-zero exit", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["skill", "install", "--target", "totally-bogus"], repo.path);
    expect(result.code).not.toBe(0);
  });

  it("add-target rejects an unknown id", async () => {
    await writeCitadelYaml(repo);
    const result = await runCli(["skill", "add-target", "bogus"], repo.path);
    expect(result.code).toBe(2);
  });

  it("runtime preread emits empty body when path is outside citadel", async () => {
    await writeCitadelYaml(repo);
    const envelope = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      cwd: repo.path,
      tool_input: { file_path: repo.resolve("src/main.ts") },
    });
    const result = await new Promise<{ stdout: string; code: number }>((res) => {
      const child = require("node:child_process").spawn(
        "node",
        [BIN_PATH, "skill", "runtime", "preread"],
        {
          cwd: repo.path,
          env: { ...process.env, NO_COLOR: "1" } as NodeJS.ProcessEnv,
        },
      );
      let stdout = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.on("close", (code: number) => res({ stdout, code }));
      child.stdin.write(envelope);
      child.stdin.end();
    });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
