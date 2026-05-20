import { describe, expect, it } from "vitest";
import {
  buildFailureEnvelope,
  buildSuccessEnvelope,
} from "../../../../src/core/connectors/envelope.js";
import { ENVELOPE_SCHEMA_VERSION } from "../../../../src/core/connectors/types.js";

describe("buildSuccessEnvelope", () => {
  it("returns the documented success shape with the per-type dataSchema embedded", () => {
    const env = buildSuccessEnvelope({
      connector: "team-gl",
      operation: "list-issues",
      data: { items: [1, 2, 3] },
      dataSchemaVersion: 1,
    });
    expect(env).toEqual({
      schema: ENVELOPE_SCHEMA_VERSION,
      connector: "team-gl",
      operation: "list-issues",
      ok: true,
      data: { items: [1, 2, 3], dataSchema: 1 },
    });
  });

  it("preserves caller-supplied data fields and only adds dataSchema", () => {
    const env = buildSuccessEnvelope({
      connector: "c",
      operation: "o",
      data: { a: 1, b: "two" },
      dataSchemaVersion: 7,
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.data.a).toBe(1);
      expect(env.data.b).toBe("two");
      expect(env.data.dataSchema).toBe(7);
    }
  });
});

describe("buildFailureEnvelope", () => {
  it("returns the documented failure shape", () => {
    const env = buildFailureEnvelope({
      connector: "team-gl",
      operation: "get-issue",
      code: "auth-failed",
      message: "GitLab returned 401 for env var TEAM_GL_TOKEN.",
    });
    expect(env).toEqual({
      schema: ENVELOPE_SCHEMA_VERSION,
      connector: "team-gl",
      operation: "get-issue",
      ok: false,
      error: {
        code: "auth-failed",
        message: "GitLab returned 401 for env var TEAM_GL_TOKEN.",
      },
    });
  });

  it("omits details when not supplied; includes when present", () => {
    const without = buildFailureEnvelope({
      connector: "c",
      operation: "o",
      code: "remote-error",
      message: "x",
    });
    expect("details" in without.error).toBe(false);

    const withDetails = buildFailureEnvelope({
      connector: "c",
      operation: "o",
      code: "remote-error",
      message: "x",
      details: { kind: "rate-limited", retryAfter: 30 },
    });
    expect(withDetails.error.details).toEqual({ kind: "rate-limited", retryAfter: 30 });
  });
});
