import { describe, expect, it } from "vitest";
import { parse, write } from "../../../../src/core/state/json.js";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("json parse", () => {
  it("returns absent on a top-level object with no state property", () => {
    expect(parse(buf('{ "title": "hello" }'))).toEqual({ kind: "absent" });
  });

  it("returns kind=valid for a top-level state property", () => {
    expect(parse(buf('{ "state": "canon", "title": "x" }'))).toEqual({
      kind: "valid",
      value: "canon",
    });
  });

  it("returns kind=invalid for an out-of-vocabulary state value", () => {
    expect(parse(buf('{ "state": "published" }'))).toEqual({
      kind: "invalid",
      raw: "published",
    });
  });

  it("returns absent when the top-level is an array", () => {
    expect(parse(buf("[1, 2, 3]"))).toEqual({ kind: "absent" });
  });

  it("returns absent when the top-level is a scalar", () => {
    expect(parse(buf("42"))).toEqual({ kind: "absent" });
  });

  it("returns absent on malformed JSON", () => {
    expect(parse(buf("{ not: valid"))).toEqual({ kind: "absent" });
  });
});

describe("json write", () => {
  it("inserts a state property when missing", () => {
    const out = write(buf('{\n  "title": "hello"\n}\n'), "canon");
    expect(parse(out)).toEqual({ kind: "valid", value: "canon" });
  });

  it("updates an existing state property", () => {
    const out = write(buf('{ "state": "draft" }'), "canon");
    expect(parse(out)).toEqual({ kind: "valid", value: "canon" });
  });

  it("is idempotent when the existing state already matches", () => {
    const input = buf('{ "state": "canon" }');
    const out = write(input, "canon");
    expect(out).toBe(input);
  });

  it("preserves a 4-space source indent", () => {
    const out = write(buf('{\n    "title": "x"\n}\n'), "canon");
    const text = out.toString("utf8");
    expect(text).toMatch(/\n {4}"/);
  });

  it("preserves the trailing newline if the source has one", () => {
    const out = write(buf('{\n  "title": "x"\n}\n'), "canon");
    expect(out.toString("utf8").endsWith("\n")).toBe(true);
  });

  it("omits a trailing newline if the source has none", () => {
    const out = write(buf('{"title":"x"}'), "canon");
    expect(out.toString("utf8").endsWith("\n")).toBe(false);
  });

  it("returns the original buffer when the top-level is an array", () => {
    const input = buf("[1, 2]");
    const out = write(input, "canon");
    expect(out).toBe(input);
  });
});
