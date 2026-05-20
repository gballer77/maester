import { describe, expect, it } from "vitest";
import { ConnectorError } from "../../../../../../src/core/connectors/errors.js";
import {
  mapGitLabHttpError,
  mapTransportError,
} from "../../../../../../src/core/connectors/types/gitlab-issues/errors.js";

const HOST = "https://gitlab.acme.internal";
const PROJECT = "team/repo";

function errFor(status: number, opts: { body?: string; retryAfter?: string; iid?: number } = {}) {
  const headers = new Headers();
  if (opts.retryAfter) headers.set("retry-after", opts.retryAfter);
  return mapGitLabHttpError({
    status,
    body: opts.body ?? "",
    headers,
    host: HOST,
    envVarName: "ARLO_GITLAB_TOKEN",
    context: { project: PROJECT, ...(opts.iid !== undefined ? { iid: opts.iid } : {}) },
  });
}

describe("mapGitLabHttpError", () => {
  it("maps 401 to auth-failed and names the env var (not its value)", () => {
    const err = errFor(401);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe("auth-failed");
    expect(err.message).toContain("ARLO_GITLAB_TOKEN");
    expect(err.message).toContain(HOST);
    expect(err.details).toMatchObject({ status: 401, envVar: "ARLO_GITLAB_TOKEN", host: HOST });
  });

  it("maps 403 to auth-failed (same as 401)", () => {
    const err = errFor(403);
    expect(err.code).toBe("auth-failed");
    expect(err.details).toMatchObject({ status: 403 });
  });

  it("maps 404 with no iid to remote-error/not-found pointing at the project", () => {
    const err = errFor(404);
    expect(err.code).toBe("remote-error");
    expect(err.details).toMatchObject({ kind: "not-found", project: PROJECT });
    expect(err.message).toContain(PROJECT);
  });

  it("maps 404 with iid to remote-error/not-found naming the issue", () => {
    const err = errFor(404, { iid: 482 });
    expect(err.code).toBe("remote-error");
    expect(err.details).toMatchObject({ kind: "not-found", iid: 482 });
    expect(err.message).toContain("482");
  });

  it("maps 429 to remote-error/rate-limited and carries Retry-After", () => {
    const err = errFor(429, { retryAfter: "60" });
    expect(err.code).toBe("remote-error");
    expect(err.details).toMatchObject({ kind: "rate-limited", retryAfter: "60" });
  });

  it("maps 500-599 to remote-error/transport", () => {
    const err = errFor(503);
    expect(err.code).toBe("remote-error");
    expect(err.details).toMatchObject({ kind: "transport", status: 503 });
  });

  it("maps unexpected status to remote-error/unexpected with truncated body", () => {
    const longBody = "x".repeat(2000);
    const err = errFor(418, { body: longBody });
    expect(err.code).toBe("remote-error");
    expect(err.details).toMatchObject({ kind: "unexpected", status: 418 });
    const body = (err.details as { body?: string })?.body ?? "";
    expect(body.length).toBeLessThanOrEqual(1025);
    expect(body.endsWith("…")).toBe(true);
  });

  it("omits envVar from message when no env var was configured", () => {
    const headers = new Headers();
    const err = mapGitLabHttpError({
      status: 401,
      body: "",
      headers,
      host: HOST,
      envVarName: undefined,
      context: { project: PROJECT },
    });
    expect(err.message).not.toContain("undefined");
    expect(err.details).not.toHaveProperty("envVar");
  });
});

describe("mapTransportError", () => {
  it("wraps a thrown fetch error into remote-error/transport", () => {
    const err = mapTransportError(new Error("ENOTFOUND gitlab.example"), HOST);
    expect(err.code).toBe("remote-error");
    expect(err.message).toContain(HOST);
    expect(err.details).toMatchObject({ kind: "transport" });
  });
});
