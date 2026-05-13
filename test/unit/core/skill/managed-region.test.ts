import { describe, expect, it } from "vitest";
import {
  extractMarkdownRegion,
  readJsonMaesterKey,
  replaceJsonMaesterKey,
  replaceMarkdownRegion,
} from "../../../../src/core/skill/managed-region.js";

describe("markdown managed region", () => {
  it("returns undefined when no region is present", () => {
    expect(extractMarkdownRegion("# Just a heading\n\nNo markers here.")).toBeUndefined();
  });

  it("extracts prefix, suffix, and version when both markers are present", () => {
    const text = [
      "# AGENTS.md",
      "User prelude.",
      "",
      "<!-- maester:skill:begin v=0.2.0 -->",
      "managed content",
      "<!-- maester:skill:end -->",
      "",
      "User postlude.",
    ].join("\n");
    const region = extractMarkdownRegion(text);
    expect(region).toBeDefined();
    expect(region?.version).toBe("0.2.0");
    expect(region?.prefix).toContain("User prelude.");
    expect(region?.suffix).toContain("User postlude.");
  });

  it("creates a fresh region when no file exists", () => {
    const out = replaceMarkdownRegion(undefined, "hello body", "1.0.0");
    expect(out).toContain("<!-- maester:skill:begin v=1.0.0 -->");
    expect(out).toContain("hello body");
    expect(out).toContain("<!-- maester:skill:end -->");
  });

  it("includes a preamble when creating a fresh file", () => {
    const out = replaceMarkdownRegion(undefined, "body", "1.0.0", "# AGENTS.md\n\nGenerated.\n");
    expect(out.startsWith("# AGENTS.md\n\nGenerated.\n")).toBe(true);
    expect(out).toContain("<!-- maester:skill:begin v=1.0.0 -->");
  });

  it("appends a region when existing file has no markers", () => {
    const existing = "# AGENTS.md\n\nUser already wrote this.\n";
    const out = replaceMarkdownRegion(existing, "body", "1.0.0");
    expect(out.startsWith(existing)).toBe(true);
    expect(out).toContain("<!-- maester:skill:begin v=1.0.0 -->");
  });

  it("preserves user content around the managed region on replace", () => {
    const text = [
      "# AGENTS.md",
      "User prelude.",
      "",
      "<!-- maester:skill:begin v=0.1.0 -->",
      "old managed",
      "<!-- maester:skill:end -->",
      "",
      "User postlude.",
    ].join("\n");
    const out = replaceMarkdownRegion(text, "new managed", "0.2.0");
    expect(out).toContain("User prelude.");
    expect(out).toContain("User postlude.");
    expect(out).toContain("new managed");
    expect(out).not.toContain("old managed");
    expect(out).toContain("v=0.2.0");
  });

  it("is idempotent on a second identical write", () => {
    const first = replaceMarkdownRegion(undefined, "stable body", "1.2.3");
    const second = replaceMarkdownRegion(first, "stable body", "1.2.3");
    expect(second).toBe(first);
  });
});

describe("claude settings maester key", () => {
  it("creates a fresh settings.json with only the maester key", () => {
    const out = replaceJsonMaesterKey(undefined, { version: "1.0.0", hooks: {} });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["maester"]);
    expect((parsed.maester as Record<string, unknown>).version).toBe("1.0.0");
  });

  it("preserves other top-level keys and their order", () => {
    const existing = JSON.stringify(
      {
        permissions: { allow: ["Bash(ls:*)"] },
        env: { FOO: "bar" },
        maester: { version: "0.1.0" },
      },
      null,
      2,
    );
    const out = replaceJsonMaesterKey(existing, { version: "0.2.0", hooks: {} });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["permissions", "env", "maester"]);
    expect((parsed.permissions as Record<string, unknown>).allow).toEqual(["Bash(ls:*)"]);
    expect((parsed.maester as Record<string, unknown>).version).toBe("0.2.0");
  });

  it("appends the maester key when not previously present", () => {
    const existing = JSON.stringify({ permissions: { allow: [] } }, null, 2);
    const out = replaceJsonMaesterKey(existing, { version: "1.0.0", hooks: {} });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["permissions", "maester"]);
  });

  it("reads back the maester key after a write", () => {
    const out = replaceJsonMaesterKey(undefined, { version: "1.2.3", hooks: { foo: 1 } });
    const block = readJsonMaesterKey(out);
    expect(block).toBeDefined();
    expect(block?.version).toBe("1.2.3");
  });

  it("returns undefined from readJsonMaesterKey on malformed input", () => {
    expect(readJsonMaesterKey(undefined)).toBeUndefined();
    expect(readJsonMaesterKey("")).toBeUndefined();
    expect(readJsonMaesterKey("not json")).toBeUndefined();
    expect(readJsonMaesterKey("[]")).toBeUndefined();
    expect(readJsonMaesterKey('{ "other": 1 }')).toBeUndefined();
  });

  it("rejects non-object top-level JSON when writing", () => {
    expect(() => replaceJsonMaesterKey("[]", { version: "1" })).toThrow();
  });
});
