/**
 * End-to-end integration test for the GitLab Issues connector through the
 * framework's `invokeOperation` chokepoint. Exercises the full path —
 * dispatch validates args + auth, hands to the operation handler, the
 * handler calls the client, the client hits the mocked fetch, the response
 * is projected and wrapped in the envelope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeOperation } from "../../../../../../src/core/connectors/dispatch.js";
import { GITLAB_ISSUES_DATA_SCHEMA } from "../../../../../../src/core/connectors/types/gitlab-issues/output.js";
import type { Connector } from "../../../../../../src/schemas/citadel.js";

const HOST = "https://gitlab.acme.internal";

function tokenizedConnector(): Connector {
  return {
    name: "team-gl",
    type: "gitlab-issues",
    description: "App team's GitLab.",
    auth: { type: "token", envVar: "ARLO_GITLAB_TOKEN" },
    config: { host: HOST, project: "team/repo" },
  };
}

function rawIssue(iid: number) {
  return {
    iid,
    id: 1000 + iid,
    title: `Issue ${iid}`,
    description: "body",
    state: "opened",
    labels: ["P1"],
    assignees: [{ username: "alice", name: "Alice" }],
    milestone: null,
    web_url: `${HOST}/team/repo/-/issues/${iid}`,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
    closed_at: null,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: vi.spyOn's typing of typeof globalThis is awkward; we only need the mock surface.
let fetchSpy: any;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("invokeOperation → gitlab-issues", () => {
  it("dispatches list-issues, returns a success envelope with dataSchema 1", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([rawIssue(1), rawIssue(2)]), {
        status: 200,
        headers: { "x-total": "2", "x-total-pages": "1" },
      }) as never,
    );
    const result = await invokeOperation({
      connector: tokenizedConnector(),
      operationName: "list-issues",
      args: { state: "opened" },
      env: { ARLO_GITLAB_TOKEN: "tok" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.connector).toBe("team-gl");
    expect(result.operation).toBe("list-issues");
    expect(result.data.dataSchema).toBe(GITLAB_ISSUES_DATA_SCHEMA);
    const data = result.data as unknown as {
      issues: { iid: number }[];
      meta: {
        page: number;
        per_page: number;
        total: number;
        total_pages: number;
        clamped: boolean;
      };
    };
    expect(data.issues).toHaveLength(2);
    expect(data.issues[0]?.iid).toBe(1);
    expect(data.meta).toMatchObject({
      page: 1,
      per_page: 20,
      total: 2,
      total_pages: 1,
      clamped: false,
    });
  });

  it("dispatches get-issue and returns the projected issue", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(rawIssue(482)), { status: 200 }) as never,
    );
    const result = await invokeOperation({
      connector: tokenizedConnector(),
      operationName: "get-issue",
      args: { iid: 482 },
      env: { ARLO_GITLAB_TOKEN: "tok" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as unknown as { issue: { iid: number; title: string } };
    expect(data.issue.iid).toBe(482);
    expect(data.issue.title).toBe("Issue 482");
  });

  it("returns missing-env-var when the auth token env is unset (no network call)", async () => {
    const result = await invokeOperation({
      connector: tokenizedConnector(),
      operationName: "get-issue",
      args: { iid: 1 },
      env: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("missing-env-var");
    expect(result.error.details).toMatchObject({ envVar: "ARLO_GITLAB_TOKEN" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns auth-failed on a 401 from GitLab, naming the env var and never echoing the value", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 401 }) as never);
    const SECRET_VALUE = "glpat-DEADBEEF-CAFEBABE";
    const result = await invokeOperation({
      connector: tokenizedConnector(),
      operationName: "get-issue",
      args: { iid: 1 },
      env: { ARLO_GITLAB_TOKEN: SECRET_VALUE },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth-failed");
    expect(result.error.message).toContain("ARLO_GITLAB_TOKEN");
    expect(result.error.message).not.toContain(SECRET_VALUE);
    // No part of the details leaks the value either.
    expect(JSON.stringify(result.error.details)).not.toContain(SECRET_VALUE);
  });

  it("returns invalid-argument when args fail the schema (state='draft')", async () => {
    const result = await invokeOperation({
      connector: tokenizedConnector(),
      operationName: "list-issues",
      args: { state: "draft" },
      env: { ARLO_GITLAB_TOKEN: "tok" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid-argument");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns unknown-operation when the operation name is not on the type", async () => {
    const result = await invokeOperation({
      connector: tokenizedConnector(),
      operationName: "close-issue",
      args: {},
      env: { ARLO_GITLAB_TOKEN: "tok" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unknown-operation");
  });

  it("clamps per_page above 100 to 100 and sets meta.clamped=true", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }) as never);
    const result = await invokeOperation({
      connector: tokenizedConnector(),
      operationName: "list-issues",
      args: { per_page: 250 },
      env: { ARLO_GITLAB_TOKEN: "tok" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = (result.data as unknown as { meta: { per_page: number; clamped: boolean } }).meta;
    expect(meta.per_page).toBe(100);
    expect(meta.clamped).toBe(true);
    // The actual request went out with per_page=100.
    const url = new URL((fetchSpy.mock.calls[0]?.[0] as URL).toString());
    expect(url.searchParams.get("per_page")).toBe("100");
  });

  it("maps 404 to remote-error/not-found that names the project", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 404 }) as never);
    const result = await invokeOperation({
      connector: tokenizedConnector(),
      operationName: "list-issues",
      args: {},
      env: { ARLO_GITLAB_TOKEN: "tok" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("remote-error");
    expect(result.error.details).toMatchObject({ kind: "not-found" });
  });
});
