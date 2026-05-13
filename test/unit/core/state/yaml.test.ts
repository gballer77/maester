import { describe, expect, it } from "vitest";
import { parse, write } from "../../../../src/core/state/yaml.js";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("yaml parse", () => {
  it("returns absent on a top-level mapping with no state key", () => {
    expect(parse(buf("title: hello\nauthor: ada\n"))).toEqual({ kind: "absent" });
  });

  it("returns kind=valid for a top-level state key", () => {
    expect(parse(buf("state: canon\ntitle: x\n"))).toEqual({ kind: "valid", value: "canon" });
  });

  it("returns kind=invalid for an out-of-vocabulary state value", () => {
    expect(parse(buf("state: published\n"))).toEqual({ kind: "invalid", raw: "published" });
  });

  it("returns absent when the document is a top-level array", () => {
    expect(parse(buf("- one\n- two\n"))).toEqual({ kind: "absent" });
  });

  it("returns absent on a malformed yaml document", () => {
    expect(parse(buf("foo: : :\n"))).toEqual({ kind: "absent" });
  });
});

describe("yaml write", () => {
  it("inserts a top-level state key when missing", () => {
    const out = write(buf("title: hello\n"), "canon");
    expect(parse(out)).toEqual({ kind: "valid", value: "canon" });
    expect(out.toString("utf8")).toContain("title: hello");
  });

  it("updates an existing state key", () => {
    const out = write(buf("state: draft\ntitle: x\n"), "canon");
    expect(parse(out)).toEqual({ kind: "valid", value: "canon" });
  });

  it("is idempotent when the existing state already matches", () => {
    const input = buf("state: canon\n");
    const out = write(input, "canon");
    expect(out).toBe(input);
  });

  it("returns the original buffer when the top-level is an array", () => {
    const input = buf("- one\n- two\n");
    const out = write(input, "canon");
    expect(out).toBe(input);
  });

  it("preserves comments in the document", () => {
    const input = buf("# this is a config\ntitle: hello\n");
    const out = write(input, "canon");
    expect(out.toString("utf8")).toContain("# this is a config");
  });
});
