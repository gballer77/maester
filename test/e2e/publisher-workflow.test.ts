import { execFile as execFileCb, execFileSync, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, makeTmpRepo } from "../helpers/tmp-repo.js";

/**
 * Plays the agent's side of the Publisher workflow (architecture §6.19,
 * `publisher-workflow.md`) with exactly the commands the skill prescribes:
 * list + inventory → draft → dry run → (user approves) → apply.
 */
const execFile = promisify(execFileCb);
const BIN_PATH = resolve(import.meta.dirname, "../../bin/maester.mjs");

async function cli(args: string[], cwd: string, input?: string) {
  if (input === undefined) {
    try {
      const { stdout } = await execFile("node", [BIN_PATH, ...args], {
        cwd,
        env: { ...process.env, NO_COLOR: "1" },
      });
      return { code: 0, json: JSON.parse(stdout) };
    } catch (err) {
      const e = err as { stdout?: string; code?: number };
      return { code: e.code ?? 1, json: e.stdout ? JSON.parse(e.stdout) : undefined };
    }
  }
  return new Promise<{ code: number; json: Record<string, unknown> }>((done) => {
    const child = spawn("node", [BIN_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.on("close", (code) => done({ code: code ?? 1, json: JSON.parse(stdout) }));
    child.stdin.end(input);
  });
}

type InventoryFile = { path: string; coveredBy: string | null; inline: { category?: string } };

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
  await repo.writeFile("README.md", "# Billing service\n");
  await fs.mkdir(repo.resolve("docs/adr"), { recursive: true });
  await repo.writeFile("docs/adr/0001-queues.md", "---\ncategory: adr\n---\n# Queues\n");
  await repo.writeFile("docs/adr/0002-retries.md", "# Retries\n");
  await repo.writeFile(".env", "STRIPE_KEY=x\n");
  execFileSync("git", ["init", "-q"], { cwd: repo.path });
});
afterEach(async () => {
  await repo.cleanup();
});

const manifest = () => fs.readFile(repo.resolve("maester.yaml"), "utf8");

describe("Publisher workflow, as the skill prescribes it", () => {
  it("create: grounded proposal → dry run → nothing written until approved → apply", async () => {
    const list = await cli(["publish", "list", "--json"], repo.path);
    expect(list.json.manifest).toBe("none");
    const inventory = await cli(["publish", "inventory", "--json"], repo.path);
    const files = inventory.json.files as InventoryFile[];
    expect(files.map((f) => f.path)).not.toContain(".env");
    expect(inventory.json.sensitive).toEqual([{ path: ".env", reason: "environment file" }]);
    // Reuse the vocabulary already in use (`adr` from an inline header).
    expect(inventory.json.vocabulary).toMatchObject({ categories: { adr: 1 } });

    const proposal = JSON.stringify({
      add: [
        { path: "README.md", description: "Billing service overview", state: "canon" },
        { path: "docs/adr/*.md", description: "Architecture decisions", category: "adr" },
      ],
      acknowledgeNarrowing: true,
    });
    const dry = await cli(
      ["publish", "apply", "--create", "--dry-run", "--json"],
      repo.path,
      proposal,
    );
    expect(dry.json).toMatchObject({ ok: true, dryRun: true });
    // The proposal is shown to the user; nothing exists on disk yet.
    await expect(fs.access(repo.resolve("maester.yaml"))).rejects.toThrow();

    const applied = await cli(["publish", "apply", "--create", "--json"], repo.path, proposal);
    expect(applied.json).toMatchObject({
      ok: true,
      created: true,
      added: ["README.md", "docs/adr/*.md"],
    });
    const after = await cli(["publish", "inventory", "--json"], repo.path);
    expect((after.json.files as InventoryFile[]).every((f) => f.coveredBy !== null)).toBe(true);
  });

  it("refine: only approved items are written; untouched entries stay byte-identical", async () => {
    await repo.writeFile(
      "maester.yaml",
      [
        "# Owned by the billing team.",
        "schemaVersion: 1",
        "documents:",
        "  - path: README.md # keep first",
        "  - path: docs/adr/*.md",
        "    description: Architecture decisions",
        "    category: adr",
        "  - path: docs/old/*.md",
        "    description: Retired notes",
        "",
      ].join("\n"),
    );
    const adrEntry =
      "  - path: docs/adr/*.md\n    description: Architecture decisions\n    category: adr\n";
    await fs.mkdir(repo.resolve("docs/runbooks"), { recursive: true });
    await repo.writeFile("docs/runbooks/paging.md", "# Paging\n");

    // Ground: one uncovered doc dir, one entry publishing nothing, README lacks a description.
    const all = await cli(["publish", "inventory", "--all", "--json"], repo.path);
    const covered = new Set((all.json.files as InventoryFile[]).map((f) => f.coveredBy));
    expect(covered.has("docs/old/*.md")).toBe(false);
    expect(
      (all.json.files as InventoryFile[]).find((f) => f.path === "docs/runbooks/paging.md")
        ?.coveredBy,
    ).toBeNull();

    const preview = await cli(["publish", "preview", "--json"], repo.path);
    expect(
      (preview.json.entries as { path: string; flags: string[] }[]).map((e) => [e.path, e.flags]),
    ).toEqual([
      ["README.md", []],
      ["docs/adr/*.md", []],
      ["docs/old/*.md", ["empty-entry"]],
    ]);

    // Proposal: addition + removal + fill-in + a modification of a populated field.
    // The user approves all but the modification (renaming the ADR category).
    const approved = JSON.stringify({
      add: [{ path: "docs/runbooks/*.md", description: "On-call runbooks", category: "runbook" }],
      remove: ["docs/old/*.md"],
      update: [{ path: "README.md", set: { description: "Billing service overview" } }],
    });
    const dry = await cli(["publish", "apply", "--dry-run", "--json"], repo.path, approved);
    expect(dry.json.ok).toBe(true);
    const applied = await cli(["publish", "apply", "--json"], repo.path, approved);
    expect(applied.json).toMatchObject({
      ok: true,
      added: ["docs/runbooks/*.md"],
      removed: ["docs/old/*.md"],
      updated: ["README.md"],
    });

    const text = await manifest();
    expect(text.startsWith("# Owned by the billing team.\n")).toBe(true);
    expect(text).toContain(
      "  - path: README.md # keep first\n    description: Billing service overview\n",
    );
    expect(text).toContain(adrEntry); // declined modification: untouched
    expect(text).not.toContain("docs/old");
  });

  it("declined proposal: no manifest is created", async () => {
    // The agent dry-runs and presents; the user declines; the agent sends nothing.
    const proposal = JSON.stringify({ add: [{ path: "README.md" }], acknowledgeNarrowing: true });
    expect(
      (await cli(["publish", "apply", "--create", "--dry-run", "--json"], repo.path, proposal)).json
        .ok,
    ).toBe(true);
    await expect(fs.access(repo.resolve("maester.yaml"))).rejects.toThrow();
  });
});
