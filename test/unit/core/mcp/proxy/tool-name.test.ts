import { describe, expect, it } from "vitest";
import { classifyUpstreamError, formatFailure } from "../../../../../src/core/mcp/proxy/reasons.js";
import {
  MAX_TOOL_NAME_LENGTH,
  proxiedToolName,
} from "../../../../../src/core/mcp/proxy/tool-name.js";

describe("proxiedToolName", () => {
  it("joins the normalized server and tool names with __", () => {
    expect(proxiedToolName("code-host", "search_issues")).toBe("code_host__search_issues");
    expect(proxiedToolName("tracker", "Get.Ticket-v2")).toBe("tracker__get_ticket_v2");
  });

  it("caps at 64 characters with a hash suffix that keeps long names distinct", () => {
    const a = proxiedToolName("server", `${"x".repeat(80)}a`);
    const b = proxiedToolName("server", `${"x".repeat(80)}b`);
    expect(a).toHaveLength(MAX_TOOL_NAME_LENGTH);
    expect(b).toHaveLength(MAX_TOOL_NAME_LENGTH);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^server__x+_[0-9a-f]{6}$/);
  });
});

describe("classifyUpstreamError", () => {
  const withCode = (code: string) => Object.assign(new Error(code), { code });

  it("maps spawn, socket, auth, timeout and protocol failures", () => {
    expect(classifyUpstreamError(withCode("ENOENT"), false).reason).toBe("command-not-found");
    expect(
      classifyUpstreamError(
        new TypeError("fetch failed", { cause: withCode("ECONNREFUSED") }),
        false,
      ).reason,
    ).toBe("connection-refused");
    expect(classifyUpstreamError(new Error("x"), true).reason).toBe("timeout");
    expect(classifyUpstreamError(new Error("Error POSTing to endpoint (HTTP 401)"), false)).toEqual(
      {
        reason: "auth-failed",
        detail: "HTTP 401",
      },
    );
    expect(
      classifyUpstreamError(new Error("MCP error -32000: Connection closed"), false).reason,
    ).toBe("exited");
    expect(classifyUpstreamError(new Error("bad shape"), false).reason).toBe("protocol-error");
  });

  it("formats a missing env var by name", () => {
    expect(formatFailure({ reason: "missing-env-var", detail: "TRACKER_TOKEN" })).toBe(
      "missing-env-var TRACKER_TOKEN",
    );
  });
});
