import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyInlineMetadata } from "../../../../src/core/state/applier.js";
import type { RuleEntry } from "../../../../src/core/state/schema.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "maester-metadata-applier-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(rel: string, content: string): Promise<void> {
  const full = resolve(dir, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

const get = (rel: string) => readFile(resolve(dir, rel), "utf8");

describe("applyInlineMetadata: category and tags", () => {
  it("writes the rule's category and tags in declared order", async () => {
    await put("docs/a.md", "# a\n");
    const result = await applyInlineMetadata(dir, [
      { pattern: "docs/**", category: "spec", tags: ["public", "api"] },
    ]);
    expect(await get("docs/a.md")).toBe(
      "---\nstate: draft\ncategory: spec\ntags:\n  - public\n  - api\n---\n# a\n",
    );
    expect(result.details[0]).toMatchObject({
      category: "spec",
      categorySource: "rule",
      tags: ["public", "api"],
      tagsSource: "rule",
    });
    expect(result.categoryBreakdown).toEqual({ byCategory: { spec: 1 }, unclassified: 0 });
    expect(result.tagRollup).toEqual({ byTag: { public: 1, api: 1 }, untagged: 0 });
  });

  it("resolves each field independently: inline category, rule tags", async () => {
    await put("docs/runbook.md", "---\ncategory: runbook\n---\n# r\n");
    const result = await applyInlineMetadata(dir, [
      { pattern: "docs/**", category: "spec", tags: ["ops"] },
    ]);
    expect(result.details[0]).toMatchObject({
      category: "runbook",
      categorySource: "inline",
      tags: ["ops"],
      tagsSource: "rule",
    });
    expect(await get("docs/runbook.md")).toContain("category: runbook");
    expect(result.warnings).toEqual([
      {
        type: "disagreement",
        file: "docs/runbook.md",
        field: "category",
        inline: "runbook",
        rule: "spec",
      },
    ]);
  });

  it("replaces rule tags wholesale with inline tags (no merge) and warns", async () => {
    await put("a.md", "---\ntags: [internal]\n---\n");
    const result = await applyInlineMetadata(dir, [{ pattern: "*.md", tags: ["public", "api"] }]);
    expect(result.details[0]?.tags).toEqual(["internal"]);
    expect(result.warnings).toEqual([
      {
        type: "disagreement",
        file: "a.md",
        field: "tags",
        inline: ["internal"],
        rule: ["public", "api"],
      },
    ]);
  });

  it("takes each field from the first matching rule that sets it (Gap 70)", async () => {
    await put("docs/adr/1.md", "# adr\n");
    const rules: RuleEntry[] = [
      { pattern: "docs/adr/*.md", tags: ["decision"] },
      { pattern: "docs/**", category: "spec", tags: ["ignored"] },
      { pattern: "**", category: "ignored" },
    ];
    const result = await applyInlineMetadata(dir, rules);
    expect(result.details[0]).toMatchObject({ category: "spec", tags: ["decision"] });
  });

  it("leaves category and tags unset when nothing declares them", async () => {
    await put("a.txt", "hello\n");
    const result = await applyInlineMetadata(dir, []);
    expect(await get("a.txt")).toBe("state: draft\nhello\n");
    expect(result.details[0]).toMatchObject({ categorySource: "unset", tagsSource: "unset" });
    expect(result.categoryBreakdown).toEqual({ byCategory: {}, unclassified: 1 });
    expect(result.tagRollup).toEqual({ byTag: {}, untagged: 1 });
  });

  it("warns on an invalid inline value and falls through to the rule", async () => {
    await put("a.html", "<!-- category: Bad Value -->\n<!-- tags: ok, Not-OK -->\n<p></p>\n");
    const result = await applyInlineMetadata(dir, [
      { pattern: "*.html", category: "page", tags: ["web"] },
    ]);
    expect(result.warnings).toEqual([
      { type: "bad-inline-category", file: "a.html", raw: "Bad Value" },
      { type: "bad-inline-tags", file: "a.html", raw: "ok, Not-OK" },
    ]);
    expect(await get("a.html")).toBe(
      "<!-- state: draft -->\n<!-- category: page -->\n<!-- tags: web -->\n<p></p>\n",
    );
  });

  it("leaves an invalid inline value untouched when no rule applies", async () => {
    await put("a.txt", "state: draft\ncategory: Bad Value\nbody\n");
    const result = await applyInlineMetadata(dir, []);
    expect(await get("a.txt")).toBe("state: draft\ncategory: Bad Value\nbody\n");
    expect(result.details[0]?.categorySource).toBe("unset");
  });

  it("is idempotent: a second run rewrites nothing", async () => {
    await put("a.md", "# a\n");
    await put("b.json", '{\n  "x": 1\n}\n');
    await put("c.yaml", "x: 1\n");
    const rules: RuleEntry[] = [
      { pattern: "*", state: "canon", category: "spec", tags: ["a", "b"] },
    ];
    await applyInlineMetadata(dir, rules);
    const before = await Promise.all(
      ["a.md", "b.json", "c.yaml"].map(async (f) => [
        await get(f),
        (await stat(resolve(dir, f))).mtimeMs,
      ]),
    );
    await new Promise((r) => setTimeout(r, 20));
    await applyInlineMetadata(dir, rules);
    const after = await Promise.all(
      ["a.md", "b.json", "c.yaml"].map(async (f) => [
        await get(f),
        (await stat(resolve(dir, f))).mtimeMs,
      ]),
    );
    expect(after).toEqual(before);
  });
});
