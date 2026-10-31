import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPreview } from "../../../../src/core/publisher/preview.js";

let repoRoot: string;
beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-preview-"));
  await write("README.md", "# R\n");
  await write("docs/adr/0001.md", "---\nstate: draft\n---\n# A\n");
  await write("docs/guides/start.md", "# G\n");
  await write("docs/api.yaml", "a: 1\n");
  await write("docs/diagram.svg", "<svg/>\n");
  await write("node_modules/x/README.md", "# dep\n");
});
afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

async function write(rel: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(repoRoot, rel)), { recursive: true });
  await fs.writeFile(path.join(repoRoot, rel), text);
}

describe("runPreview", () => {
  it("resolves files per entry with effective fields and their sources", async () => {
    const report = await runPreview(repoRoot, [
      { path: "README.md", state: "canon", category: "overview" },
      { path: "docs/**/*", category: "docs", tags: ["internal"], state: "canon" },
    ]);
    if (report.manifest !== "listed") throw new Error("expected listed");
    expect(report.totalFiles).toBe(5);
    expect(report.entries[0]?.files).toEqual([
      {
        path: "README.md",
        state: "canon",
        stateSource: "rule",
        category: "overview",
        categorySource: "rule",
        tagsSource: "unset",
      },
    ]);
    const docs = report.entries[1]?.files ?? [];
    expect(docs.find((f) => f.path === "docs/adr/0001.md")).toMatchObject({
      state: "draft",
      stateSource: "inline",
      category: "docs",
      tags: ["internal"],
    });
    expect(docs.find((f) => f.path === "docs/diagram.svg")).toMatchObject({
      state: "untagged",
      categorySource: "untagged",
    });
    // inline state disagreeing with the rule is reported, as sync does
    expect(report.warnings).toEqual([
      expect.objectContaining({ type: "disagreement", file: "docs/adr/0001.md", field: "state" }),
    ]);
  });

  it("flags empty, redundant and multi-matched entries", async () => {
    const report = await runPreview(repoRoot, [
      { path: "docs/**/*.md" },
      { path: "docs/adr/*.md", category: "adr" },
      { path: "nothing/*.md" },
    ]);
    if (report.manifest !== "listed") throw new Error("expected listed");
    expect(report.entries.map((e) => [e.path, e.flags])).toEqual([
      ["docs/**/*.md", []],
      ["docs/adr/*.md", ["redundant"]],
      ["nothing/*.md", ["empty-entry"]],
    ]);
    const adr = report.entries[1]?.files[0];
    expect(adr?.multiMatch).toEqual(["docs/**/*.md", "docs/adr/*.md"]);
    // the first rule that sets category wins (Gap 70) — the earlier glob sets none
    expect(adr?.category).toBe("adr");
  });

  it("reports per-directory counts for whole-repository publishing", async () => {
    for (const documents of [undefined, []]) {
      const report = await runPreview(repoRoot, documents);
      if (report.manifest === "listed") throw new Error("expected whole repository");
      expect(report.manifest).toBe(documents === undefined ? "none" : "whole-repository");
      expect(report.directories).toEqual([
        { dir: ".", files: 1 },
        { dir: "docs", files: 2 },
        { dir: "docs/adr", files: 1 },
        { dir: "docs/guides", files: 1 },
      ]);
    }
  });
});
