import { describe, expect, it } from "vitest";
import { ConnectorError } from "../../../../src/core/connectors/errors.js";
import { CONNECTOR_ERROR_CODES } from "../../../../src/core/connectors/types.js";

describe("ConnectorError", () => {
  it("carries the documented code, message, and optional details", () => {
    const err = new ConnectorError("auth-failed", "bad token", { hint: "rotate it" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConnectorError");
    expect(err.code).toBe("auth-failed");
    expect(err.message).toBe("bad token");
    expect(err.details).toEqual({ hint: "rotate it" });
  });

  it("leaves details undefined when not supplied", () => {
    const err = new ConnectorError("remote-error", "no service");
    expect(err.details).toBeUndefined();
  });
});

describe("CONNECTOR_ERROR_CODES", () => {
  it("contains the bounded set from architecture Gap 44", () => {
    expect(new Set(CONNECTOR_ERROR_CODES)).toEqual(
      new Set([
        "missing-env-var",
        "connector-not-found",
        "unknown-operation",
        "invalid-argument",
        "auth-failed",
        "remote-error",
        "internal-error",
      ]),
    );
  });
});
