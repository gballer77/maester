import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyState } from "../../../../src/core/state/applier.js";

async function writeAt(root: string, rel: string, content: string): Promise<void> {
  const full = resolve(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function readAt(root: string, rel: string): Promise<string> {
  return readFile(resolve(root, rel), "utf8");
}

describe("applyState", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "maester-state-applier-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("defaults to draft when no inline state and no matching rule", async () => {
    await writeAt(dir, "README.md", "# hello\n");
    const result = await applyState(dir, []);
    expect(result.breakdown).toEqual({ canon: 0, draft: 1, untagged: 0 });
    expect(result.details[0]?.sourceOfTruth).toBe("default");
    const md = await readAt(dir, "README.md");
    expect(md).toContain("state: draft");
  });

  it("applies the matching rule's state when no inline state", async () => {
    await writeAt(dir, "docs/intro.md", "# intro\n");
    const result = await applyState(dir, [{ pattern: "docs/**/*.md", state: "canon" }]);
    expect(result.breakdown).toEqual({ canon: 1, draft: 0, untagged: 0 });
    expect(result.details[0]?.sourceOfTruth).toBe("rule");
    expect(await readAt(dir, "docs/intro.md")).toContain("state: canon");
  });

  it("inline wins over a conflicting rule and emits a disagreement warning", async () => {
    await writeAt(dir, "docs/wip.md", "---\nstate: draft\n---\n\nbody\n");
    const result = await applyState(dir, [{ pattern: "docs/**/*.md", state: "canon" }]);
    expect(result.breakdown).toEqual({ canon: 0, draft: 1, untagged: 0 });
    expect(result.details[0]?.sourceOfTruth).toBe("inline");
    expect(result.warnings).toEqual([
      { type: "disagreement", file: "docs/wip.md", inline: "draft", rule: "canon" },
    ]);
  });

  it("does not emit disagreement when inline matches the rule", async () => {
    await writeAt(dir, "docs/x.md", "---\nstate: canon\n---\n\nbody\n");
    const result = await applyState(dir, [{ pattern: "docs/**/*.md", state: "canon" }]);
    expect(result.warnings).toEqual([]);
  });

  it("invalid inline value falls through to rule with a bad-inline-state warning", async () => {
    await writeAt(dir, "docs/typo.md", "---\nstate: published\n---\n\nbody\n");
    const result = await applyState(dir, [{ pattern: "docs/**/*.md", state: "canon" }]);
    expect(result.breakdown).toEqual({ canon: 1, draft: 0, untagged: 0 });
    expect(result.details[0]?.sourceOfTruth).toBe("rule");
    expect(result.warnings).toEqual([
      { type: "bad-inline-state", file: "docs/typo.md", raw: "published" },
    ]);
    expect(await readAt(dir, "docs/typo.md")).toContain("state: canon");
  });

  it("invalid inline value falls through to default when no rule matches", async () => {
    await writeAt(dir, "docs/typo.md", "---\nstate: nope\n---\n\nbody\n");
    const result = await applyState(dir, []);
    expect(result.breakdown).toEqual({ canon: 0, draft: 1, untagged: 0 });
    expect(result.details[0]?.sourceOfTruth).toBe("default");
    expect(result.warnings).toEqual([
      { type: "bad-inline-state", file: "docs/typo.md", raw: "nope" },
    ]);
  });

  it("counts files in unsupported formats as untagged and leaves them untouched", async () => {
    const original = "fake binary data\n";
    await writeAt(dir, "asset.png", original);
    const result = await applyState(dir, []);
    expect(result.breakdown).toEqual({ canon: 0, draft: 0, untagged: 1 });
    expect(result.details[0]).toEqual({
      file: "asset.png",
      state: "untagged",
      sourceOfTruth: "untagged",
    });
    expect(await readAt(dir, "asset.png")).toBe(original);
  });

  it("first-match wins when multiple rules match the same file", async () => {
    await writeAt(dir, "docs/runbooks/x.md", "# x\n");
    const result = await applyState(dir, [
      { pattern: "docs/**/*.md", state: "draft" },
      { pattern: "docs/runbooks/**/*.md", state: "canon" },
    ]);
    expect(result.breakdown).toEqual({ canon: 0, draft: 1, untagged: 0 });
    expect(await readAt(dir, "docs/runbooks/x.md")).toContain("state: draft");
  });

  it("a matching rule with no state defers to the default", async () => {
    await writeAt(dir, "docs/x.md", "# x\n");
    const result = await applyState(dir, [{ pattern: "docs/**/*.md" }]);
    expect(result.breakdown).toEqual({ canon: 0, draft: 1, untagged: 0 });
    expect(result.details[0]?.sourceOfTruth).toBe("default");
  });

  it("handles a mixed-format tree end-to-end", async () => {
    await writeAt(dir, "README.md", "# readme\n");
    await writeAt(dir, "site/index.html", "<!DOCTYPE html>\n<html></html>\n");
    await writeAt(dir, "data/config.yaml", "title: hello\n");
    await writeAt(dir, "data/manifest.json", '{ "name": "x" }');
    await writeAt(dir, "notes.txt", "hello world\n");
    await writeAt(dir, "logo.svg", "<svg/>");

    const result = await applyState(dir, [{ pattern: "**/*", state: "canon" }]);

    expect(result.breakdown).toEqual({ canon: 5, draft: 0, untagged: 1 });
    expect(await readAt(dir, "README.md")).toContain("state: canon");
    expect(await readAt(dir, "site/index.html")).toMatch(/^<!-- state: canon -->\n/);
    expect(await readAt(dir, "data/config.yaml")).toContain("state: canon");
    expect(await readAt(dir, "data/manifest.json")).toContain('"state": "canon"');
    expect(await readAt(dir, "notes.txt")).toMatch(/^state: canon\n/);
    expect(await readAt(dir, "logo.svg")).toBe("<svg/>");
  });

  it("skips the provenance marker", async () => {
    await writeAt(dir, ".maester-source.json", '{ "sourceName": "x" }');
    await writeAt(dir, "README.md", "# x\n");
    const result = await applyState(dir, []);
    expect(result.details.map((d) => d.file)).toEqual(["README.md"]);
    expect(await readAt(dir, ".maester-source.json")).toBe('{ "sourceName": "x" }');
  });

  it("skips a root-level maester.yaml (treated as a sync artifact, not a document)", async () => {
    await writeAt(dir, "maester.yaml", "schemaVersion: 1\ndocuments:\n  - path: README.md\n");
    await writeAt(dir, "README.md", "# x\n");
    const result = await applyState(dir, []);
    expect(result.details.map((d) => d.file)).toEqual(["README.md"]);
    expect(await readAt(dir, "maester.yaml")).not.toContain("state: draft");
  });

  it("tags a nested maester.yaml (only the root manifest is skipped)", async () => {
    await writeAt(dir, "docs/maester.yaml", "title: nested\n");
    const result = await applyState(dir, []);
    expect(result.details.map((d) => d.file)).toEqual(["docs/maester.yaml"]);
    expect(await readAt(dir, "docs/maester.yaml")).toContain("state: draft");
  });

  it("is idempotent: re-running with the same rules does not modify already-tagged files", async () => {
    await writeAt(dir, "README.md", "# hello\n");
    await applyState(dir, [{ pattern: "**/*", state: "canon" }]);
    const afterFirst = await readAt(dir, "README.md");
    await applyState(dir, [{ pattern: "**/*", state: "canon" }]);
    expect(await readAt(dir, "README.md")).toBe(afterFirst);
  });
});
