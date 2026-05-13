import { describe, expect, it } from "vitest";
import { parse, write } from "../../../../src/core/state/plaintext.js";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("plaintext parse", () => {
  it("returns absent when line 1 has no state marker", () => {
    expect(parse(buf("hello world\nthis is text\n"))).toEqual({ kind: "absent" });
  });

  it("returns kind=valid for 'state: canon' on line 1", () => {
    expect(parse(buf("state: canon\nbody\n"))).toEqual({ kind: "valid", value: "canon" });
  });

  it("returns kind=valid for 'state: draft' on line 1", () => {
    expect(parse(buf("state: draft\nbody\n"))).toEqual({ kind: "valid", value: "draft" });
  });

  it("returns kind=invalid for an out-of-vocabulary value", () => {
    expect(parse(buf("state: published\nbody\n"))).toEqual({
      kind: "invalid",
      raw: "published",
    });
  });

  it("ignores state lines that appear after line 1", () => {
    expect(parse(buf("title\nstate: canon\n"))).toEqual({ kind: "absent" });
  });
});

describe("plaintext write", () => {
  it("prepends a state line when none exists on line 1", () => {
    const out = write(buf("body line one\nbody line two\n"), "canon");
    const text = out.toString("utf8");
    expect(text.startsWith("state: canon\nbody line one")).toBe(true);
    expect(parse(out)).toEqual({ kind: "valid", value: "canon" });
  });

  it("replaces an existing state line on line 1", () => {
    const out = write(buf("state: draft\nbody\n"), "canon");
    expect(parse(out)).toEqual({ kind: "valid", value: "canon" });
  });

  it("is idempotent when the existing state already matches", () => {
    const input = buf("state: canon\nbody\n");
    const out = write(input, "canon");
    expect(out).toBe(input);
  });
});
