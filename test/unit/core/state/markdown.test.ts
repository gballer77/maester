import { describe, expect, it } from "vitest";
import { parse, write } from "../../../../src/core/state/markdown.js";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("markdown parse", () => {
  it("returns absent when no frontmatter is present", () => {
    expect(parse(buf("# Hello\n\nbody\n"))).toEqual({ kind: "absent" });
  });

  it("returns absent when frontmatter has no state field", () => {
    expect(parse(buf("---\ntitle: x\n---\n\nbody\n"))).toEqual({ kind: "absent" });
  });

  it("returns kind=valid for a canon state", () => {
    expect(parse(buf("---\nstate: canon\n---\n\nbody\n"))).toEqual({
      kind: "valid",
      value: "canon",
    });
  });

  it("returns kind=valid for a draft state", () => {
    expect(parse(buf("---\nstate: draft\n---\n\nbody\n"))).toEqual({
      kind: "valid",
      value: "draft",
    });
  });

  it("returns kind=invalid for an out-of-vocabulary value", () => {
    expect(parse(buf("---\nstate: published\n---\n\nbody\n"))).toEqual({
      kind: "invalid",
      raw: "published",
    });
  });
});

describe("markdown write", () => {
  it("prepends a fresh frontmatter block when none exists", () => {
    const out = write(buf("# Hello\n\nbody\n"), "canon");
    const result = parse(out);
    expect(result).toEqual({ kind: "valid", value: "canon" });
    expect(out.toString("utf8")).toContain("# Hello");
    expect(out.toString("utf8")).toContain("body");
  });

  it("preserves existing frontmatter fields", () => {
    const out = write(buf("---\ntitle: x\nauthor: ada\n---\n\nbody\n"), "canon");
    const text = out.toString("utf8");
    expect(text).toMatch(/title:\s*['"]?x['"]?/);
    expect(text).toMatch(/author:\s*['"]?ada['"]?/);
    expect(text).toContain("state: canon");
    expect(text).toContain("body");
  });

  it("updates an existing state field", () => {
    const out = write(buf("---\nstate: draft\n---\n\nbody\n"), "canon");
    expect(parse(out)).toEqual({ kind: "valid", value: "canon" });
  });

  it("is idempotent when the existing state already matches", () => {
    const input = buf("---\nstate: canon\n---\n\nbody\n");
    const out = write(input, "canon");
    expect(out).toBe(input);
  });
});
