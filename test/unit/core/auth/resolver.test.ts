import { describe, expect, it } from "vitest";
import { resolveAuth } from "../../../../src/core/auth/resolver.js";
import { AuthError } from "../../../../src/core/errors.js";

describe("resolveAuth", () => {
  it("returns delegated when auth is undefined", () => {
    expect(resolveAuth(undefined)).toEqual({ type: "delegated" });
  });

  it("returns delegated for auth.type='none'", () => {
    expect(resolveAuth({ type: "none" })).toEqual({ type: "delegated" });
  });

  it("reads the token from the named env var and surfaces the env-var name", () => {
    expect(resolveAuth({ type: "token", envVar: "MAESTER_FAKE" }, { MAESTER_FAKE: "abc" })).toEqual(
      {
        type: "token",
        value: "abc",
        envVar: "MAESTER_FAKE",
      },
    );
  });

  it("throws AuthError when the env var is missing", () => {
    expect(() => resolveAuth({ type: "token", envVar: "MAESTER_FAKE" }, {})).toThrow(AuthError);
  });

  it("throws AuthError when the env var is empty", () => {
    expect(() =>
      resolveAuth({ type: "token", envVar: "MAESTER_FAKE" }, { MAESTER_FAKE: "" }),
    ).toThrow(AuthError);
  });
});
