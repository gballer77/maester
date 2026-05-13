import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, STATE_VALUES, parseState } from "../../../../src/core/state/schema.js";

describe("state schema", () => {
  it("defines exactly the v1 vocabulary", () => {
    expect(STATE_VALUES).toEqual(["draft", "canon"]);
  });

  it("defaults to draft", () => {
    expect(DEFAULT_STATE).toBe("draft");
  });
});

describe("parseState", () => {
  it("returns kind=absent for undefined", () => {
    expect(parseState(undefined)).toEqual({ kind: "absent" });
  });

  it("returns kind=absent for null", () => {
    expect(parseState(null)).toEqual({ kind: "absent" });
  });

  it("returns kind=absent for an empty string", () => {
    expect(parseState("")).toEqual({ kind: "absent" });
  });

  it("returns kind=valid for 'draft'", () => {
    expect(parseState("draft")).toEqual({ kind: "valid", value: "draft" });
  });

  it("returns kind=valid for 'canon'", () => {
    expect(parseState("canon")).toEqual({ kind: "valid", value: "canon" });
  });

  it("returns kind=invalid for out-of-vocabulary values", () => {
    expect(parseState("published")).toEqual({ kind: "invalid", raw: "published" });
  });

  it("returns kind=invalid for case-mismatched values", () => {
    expect(parseState("Canon")).toEqual({ kind: "invalid", raw: "Canon" });
  });

  it("coerces non-string scalars into the raw field for kind=invalid", () => {
    expect(parseState(42)).toEqual({ kind: "invalid", raw: "42" });
  });
});
