import { execFile as execFileCb, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

const execFile = promisify(execFileCb);
const BIN_PATH = resolve(import.meta.dirname, "../../bin/maester.mjs");

type Run = { stdout: string; stderr: string; code: number };

async function runCli(args: string[], cwd: string): Promise<Run> {
  try {
    const { stdout, stderr } = await execFile("node", [BIN_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

/** Run with `input` piped to stdin. */
function runWithStdin(args: string[], cwd: string, input: string): Promise<Run> {
  return new Promise((done) => {
    const child = spawn("node", [BIN_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("close", (code) => done({ stdout, stderr, code: code ?? 1 }));
    child.stdin.end(input);
  });
}

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
  await repo.writeFile("README.md", "# Service\n");
});
afterEach(async () => {
  await repo.cleanup();
});

const manifest = () => fs.readFile(repo.resolve("maester.yaml"), "utf8");

describe("CLI: maester publish apply", () => {
  it("creates a manifest from a stdin change set, then reports it via list --json", async () => {
    const none = await runCli(["publish", "list", "--json"], repo.path);
    expect(JSON.parse(none.stdout)).toMatchObject({ manifest: "none", documents: [] });

    const set = JSON.stringify({
      add: [
        { path: "README.md", description: "Service overview", state: "canon" },
        { path: "docs/**/*.md", category: "guide", tags: ["internal"] },
      ],
      acknowledgeNarrowing: true,
    });
    const missing = await runWithStdin(["publish", "apply", "--json"], repo.path, set);
    expect(missing.code).toBe(2);
    expect(JSON.parse(missing.stdout).error.message).toMatch(/--create/);

    const dry = await runWithStdin(
      ["publish", "apply", "--create", "--dry-run", "--json"],
      repo.path,
      set,
    );
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.stdout)).toMatchObject({ ok: true, dryRun: true, created: false });
    await expect(fs.access(repo.resolve("maester.yaml"))).rejects.toThrow();

    const created = await runWithStdin(["publish", "apply", "--create", "--json"], repo.path, set);
    expect(created.code).toBe(0);
    expect(JSON.parse(created.stdout)).toMatchObject({
      ok: true,
      created: true,
      added: ["README.md", "docs/**/*.md"],
    });
    expect(await manifest()).toMatch(/^# maester\.yaml/);

    const list = JSON.parse((await runCli(["publish", "list", "--json"], repo.path)).stdout);
    expect(list).toMatchObject({
      manifest: "listed",
      documents: [
        { path: "README.md", description: "Service overview", state: "canon" },
        { path: "docs/**/*.md", category: "guide", tags: ["internal"] },
      ],
    });
  });

  it("reads --from, and refuses invalid input with exit 2 and no write", async () => {
    await repo.writeFile("maester.yaml", "schemaVersion: 1\ndocuments:\n  - path: README.md\n");
    const before = await manifest();
    await repo.writeFile("set.json", JSON.stringify({ add: [{ path: "x.md", category: "Bad" }] }));
    const bad = await runCli(["publish", "apply", "--from", "set.json", "--json"], repo.path);
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.stdout).error.field).toMatch(/category$/);
    expect(await manifest()).toBe(before);

    await repo.writeFile("set.json", JSON.stringify({ add: [{ path: "x.md" }] }));
    const ok = await runCli(["publish", "apply", "--from", "set.json"], repo.path);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/\+ x\.md\nUpdated .*maester\.yaml \(2 documents\)/);
  });
});

describe("CLI: maester publish add | update | remove --path", () => {
  it("edits one entry at a time without prompts", async () => {
    const add = await runCli(
      [
        "publish",
        "add",
        "--path",
        "README.md",
        "--create",
        "--acknowledge-narrowing",
        "--tags",
        "intro, public",
      ],
      repo.path,
    );
    expect(add.code).toBe(0);
    await runCli(["publish", "add", "--path", "CHANGELOG.md"], repo.path);

    const update = await runCli(
      ["publish", "update", "--path", "README.md", "--category", "overview", "--unset", "tags"],
      repo.path,
    );
    expect(update.code).toBe(0);
    expect(await manifest()).toMatch(/- path: README\.md\n {4}category: overview\n/);

    const badUnset = await runCli(
      ["publish", "update", "--path", "README.md", "--unset", "path"],
      repo.path,
    );
    expect(badUnset.code).toBe(2);

    expect((await runCli(["publish", "remove", "--path", "CHANGELOG.md"], repo.path)).code).toBe(0);
    const last = await runCli(["publish", "remove", "--path", "README.md", "--json"], repo.path);
    expect(last.code).toBe(2);
    expect(JSON.parse(last.stdout).error.field).toBe("remove");
  });

  it("refuses a sensitive path unless --allow-sensitive", async () => {
    await repo.writeFile("maester.yaml", "schemaVersion: 1\ndocuments:\n  - path: README.md\n");
    const refused = await runCli(["publish", "add", "--path", ".env"], repo.path);
    expect(refused.code).toBe(2);
    expect(refused.stderr + refused.stdout).toMatch(/environment file/);
    const allowed = await runCli(
      ["publish", "add", "--path", ".env", "--allow-sensitive"],
      repo.path,
    );
    expect(allowed.code).toBe(0);
  });
});

describe("CLI: maester skill --skill publisher", () => {
  it("installs in a repo with no citadel, while the Grand Maester still requires one", async () => {
    const gm = await runCli(["skill", "install", "--target", "claude-code"], repo.path);
    expect(gm.code).toBe(2);

    const pub = await runCli(
      [
        "skill",
        "install",
        "--skill",
        "publisher",
        "--target",
        "claude-code",
        "--target",
        "agents-md",
      ],
      repo.path,
    );
    expect(pub.code).toBe(0);
    expect(pub.stdout + pub.stderr).toMatch(/Installed Publisher for 2 target\(s\)/);
    await fs.access(repo.resolve(".claude/skills/maester-publisher/SKILL.md"));
    await expect(fs.access(repo.resolve(".mcp.json"))).rejects.toThrow();

    const status = await runCli(["--json", "skill", "status"], repo.path);
    expect(status.code).toBe(0);
    const rows = status.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((r) => r.type !== "summary");
    expect(rows.filter((r) => r.state === "up-to-date").map((r) => `${r.kind}:${r.id}`)).toEqual([
      "publisher:claude-code",
      "publisher:agents-md",
    ]);

    const upgrade = await runCli(["skill", "upgrade"], repo.path);
    expect(upgrade.code).toBe(0);

    const bad = await runCli(["skill", "install", "--skill", "nope"], repo.path);
    expect(bad.code).not.toBe(0);
  });
});

describe("CLI: maester publish inventory", () => {
  it("prints a JSON report and a human summary; rejects a bad --limit", async () => {
    await repo.writeFile(".env", "X=1\n");
    const json = await runCli(["publish", "inventory", "--json"], repo.path);
    expect(json.code).toBe(0);
    const report = JSON.parse(json.stdout);
    expect(report).toMatchObject({ manifest: "none", truncated: false });
    expect(report.files.map((f: { path: string }) => f.path)).toContain("README.md");
    expect(report.sensitive).toEqual([{ path: ".env", reason: "environment file" }]);

    const human = await runCli(["publish", "inventory"], repo.path);
    expect(human.stdout).toMatch(/No maester\.yaml/);
    expect(human.stdout).toMatch(/! \.env \(environment file\)/);

    expect((await runCli(["publish", "inventory", "--limit", "0"], repo.path)).code).toBe(2);
  });
});

describe("CLI: maester publish preview", () => {
  it("previews the current manifest, a change set from stdin, and whole-repository mode", async () => {
    const whole = await runCli(["publish", "preview"], repo.path);
    expect(whole.code).toBe(0);
    expect(whole.stdout).toMatch(/No maester\.yaml — citadels publish the whole repository/);

    await repo.writeFile(
      "maester.yaml",
      "schemaVersion: 1\ndocuments:\n  - path: README.md\n    state: canon\n",
    );
    const current = await runCli(["publish", "preview"], repo.path);
    expect(current.stdout).toMatch(/README\.md — 1 file\n {2}README\.md {2}canon \(rule\)/);

    const proposed = await runWithStdin(
      ["publish", "preview", "--from", "-", "--json"],
      repo.path,
      JSON.stringify({ add: [{ path: "missing/*.md" }] }),
    );
    expect(proposed.code).toBe(0);
    expect(JSON.parse(proposed.stdout).entries[1]).toMatchObject({
      path: "missing/*.md",
      flags: ["empty-entry"],
    });
    // previewing never writes
    expect(await manifest()).not.toContain("missing");
  });
});
