import { describe, expect, it } from "vitest";
import { parse, write } from "../../../../src/core/state/html.js";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("html parse", () => {
  it("returns absent when no state comment is on line 1", () => {
    expect(parse(buf("<!DOCTYPE html>\n<html></html>\n"))).toEqual({ kind: "absent" });
  });

  it("returns kind=valid when line 1 is the state comment (canon)", () => {
    expect(parse(buf("<!-- state: canon -->\n<!DOCTYPE html>\n<html></html>\n"))).toEqual({
      kind: "valid",
      value: "canon",
    });
  });

  it("returns kind=valid when line 1 is the state comment (draft)", () => {
    expect(parse(buf("<!-- state: draft -->\n<!DOCTYPE html>\n"))).toEqual({
      kind: "valid",
      value: "draft",
    });
  });

  it("returns kind=invalid for an out-of-vocabulary value on line 1", () => {
    expect(parse(buf("<!-- state: published -->\n<!DOCTYPE html>\n"))).toEqual({
      kind: "invalid",
      raw: "published",
    });
  });

  it("ignores state comments that appear after line 1", () => {
    const text = "<!DOCTYPE html>\n<!-- state: canon -->\n";
    expect(parse(buf(text))).toEqual({ kind: "absent" });
  });
});

describe("html write", () => {
  it("prepends a state comment before DOCTYPE when none exists", () => {
    const out = write(buf("<!DOCTYPE html>\n<html></html>\n"), "canon");
    const text = out.toString("utf8");
    expect(text.startsWith("<!-- state: canon -->\n<!DOCTYPE html>")).toBe(true);
    expect(parse(out)).toEqual({ kind: "valid", value: "canon" });
  });

  it("replaces an existing state comment on line 1", () => {
    const out = write(buf("<!-- state: draft -->\n<!DOCTYPE html>\n"), "canon");
    expect(parse(out)).toEqual({ kind: "valid", value: "canon" });
    expect(out.toString("utf8").startsWith("<!-- state: canon -->\n<!DOCTYPE html>")).toBe(true);
  });

  it("is idempotent when the existing state already matches", () => {
    const input = buf("<!-- state: canon -->\n<!DOCTYPE html>\n");
    const out = write(input, "canon");
    expect(out).toBe(input);
  });

  it("preserves CRLF line endings on replacement", () => {
    const out = write(buf("<!-- state: draft -->\r\n<!DOCTYPE html>\r\n"), "canon");
    expect(out.toString("utf8").startsWith("<!-- state: canon -->\r\n")).toBe(true);
  });
});
