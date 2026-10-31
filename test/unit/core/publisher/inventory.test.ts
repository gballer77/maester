import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileKind, runInventory } from "../../../../src/core/publisher/inventory.js";

let repoRoot: string;
beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-inventory-"));
});
afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

async function write(rel: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(repoRoot, rel)), { recursive: true });
  await fs.writeFile(path.join(repoRoot, rel), text);
}

const gitInit = () => execFileSync("git", ["init", "-q"], { cwd: repoRoot });

async function fixture(): Promise<void> {
  await write("README.md", "# Service\nSECRET-LOOKING BODY TEXT\n");
  await write("docs/adr/0001.md", "---\nstate: canon\ncategory: adr\ntags: [arch]\n---\n# A\n");
  await write("docs/guides/start.md", "---\ncategory: guide\ntags: [arch, onboarding]\n---\n");
  await write("docs/guides/config.yaml", "a: 1\n");
  await write("src/index.ts", "export {};\n");
  await write("node_modules/pkg/README.md", "# dep\n");
  await write("build/out.md", "# generated\n");
  await write(".env", "TOKEN=x\n");
  await write("secrets/notes.md", "# keys\n");
  await write(".gitignore", "build/\n.env\n");
}

describe("runInventory", () => {
  it("lists docs with inline metadata (never content), honouring .gitignore and excludes", async () => {
    await fixture();
    gitInit();
    const report = await runInventory(repoRoot);
    expect(report.manifest).toBe("none");
    expect(report.files.map((f) => f.path)).toEqual([
      "README.md",
      "docs/adr/0001.md",
      "docs/guides/start.md",
    ]);
    expect(report.files[1]).toEqual({
      path: "docs/adr/0001.md",
      bytes: expect.any(Number),
      kind: "doc",
      inline: { state: "canon", category: "adr", tags: ["arch"] },
      coveredBy: null,
    });
    expect(JSON.stringify(report)).not.toContain("SECRET-LOOKING");
    // gitignored or not, sensitive files are flagged — and never candidates
    expect(report.sensitive).toEqual([
      { path: ".env", reason: "environment file" },
      { path: "secrets/notes.md", reason: "secrets directory" },
    ]);
    expect(report.vocabulary).toEqual({
      categories: { adr: 1, guide: 1 },
      tags: { arch: 2, onboarding: 1 },
    });
  });

  it("--all adds data and other files; kinds by extension", async () => {
    await fixture();
    gitInit();
    const report = await runInventory(repoRoot, { all: true });
    expect(report.files.map((f) => [f.path, f.kind])).toEqual(
      expect.arrayContaining([
        ["docs/guides/config.yaml", "data"],
        ["src/index.ts", "other"],
        [".gitignore", "other"],
      ]),
    );
    expect(fileKind("a.MDX")).toBe("doc");
  });

  it("reports coverage, manifest mode, and counts manifest vocabulary", async () => {
    await fixture();
    gitInit();
    await write(
      "maester.yaml",
      "schemaVersion: 1\ndocuments:\n  - path: docs/adr/*.md\n    category: adr\n    tags: [decisions]\n",
    );
    const report = await runInventory(repoRoot);
    expect(report.manifest).toBe("listed");
    expect(report.files.find((f) => f.path === "docs/adr/0001.md")?.coveredBy).toBe(
      "docs/adr/*.md",
    );
    expect(report.vocabulary.categories.adr).toBe(2);
    expect(report.vocabulary.tags.decisions).toBe(1);
    expect(report.directories).toEqual([
      { dir: ".", docFiles: 1, uncovered: 1 },
      { dir: "docs/adr", docFiles: 1, uncovered: 0 },
      { dir: "docs/guides", docFiles: 1, uncovered: 1 },
    ]);

    await write("maester.yaml", "schemaVersion: 1\ndocuments: []\n");
    expect((await runInventory(repoRoot)).manifest).toBe("whole-repository");
  });

  it("truncates files but keeps the rollup and sensitive list complete", async () => {
    await fixture();
    gitInit();
    const report = await runInventory(repoRoot, { limit: 1 });
    expect(report.truncated).toBe(true);
    expect(report.files).toHaveLength(1);
    expect(report.directories.reduce((n, d) => n + d.docFiles, 0)).toBe(3);
    expect(report.sensitive).toHaveLength(2);
  });

  it("walks the filesystem outside git (no .gitignore), still skipping built-in excludes", async () => {
    await fixture();
    const report = await runInventory(repoRoot);
    expect(report.files.map((f) => f.path)).toEqual([
      "README.md",
      "docs/adr/0001.md",
      "docs/guides/start.md",
    ]);
  });

  it("leaves out a citadel's synced destinations", async () => {
    await fixture();
    gitInit();
    await write(
      "citadel.yaml",
      "schemaVersion: 1\nsources:\n  - name: upstream\n    url: https://example.com/u.git\n",
    );
    await write("citadel/upstream/README.md", "# someone else's\n");
    const report = await runInventory(repoRoot);
    expect(report.files.map((f) => f.path)).not.toContain("citadel/upstream/README.md");
  });
});
