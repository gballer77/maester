import { describe, expect, it } from "vitest";
import { ConnectorError } from "../../../../../../src/core/connectors/errors.js";
import {
  encodeProjectSegment,
  getIssue,
  listIssues,
} from "../../../../../../src/core/connectors/types/gitlab-issues/client.js";

const HOST = "https://gitlab.acme.internal";

describe("encodeProjectSegment", () => {
  it("treats an all-digits string as a numeric project ID and passes it verbatim", () => {
    expect(encodeProjectSegment("12345")).toBe("12345");
  });

  it("URL-encodes a path-style project value (single-level)", () => {
    expect(encodeProjectSegment("group/project")).toBe("group%2Fproject");
  });

  it("URL-encodes a nested-group project path", () => {
    expect(encodeProjectSegment("acme/widgets/widgets-core")).toBe("acme%2Fwidgets%2Fwidgets-core");
  });
});

/**
 * Build a fake `fetch` that captures the most recent request and returns the
 * configured response. Lets us assert URL construction + headers without
 * touching the network.
 */
function fakeFetch(response: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    calls.push({ url, init });
    const headers = new Headers(response.headers ?? {});
    return new Response(JSON.stringify(response.body ?? null), {
      status: response.status ?? 200,
      headers,
    });
  };
  return { impl, calls };
}

function rawIssue(iid: number) {
  return {
    iid,
    id: 1000 + iid,
    title: `Issue ${iid}`,
    description: null,
    state: "opened",
    labels: [],
    assignees: [],
    milestone: null,
    web_url: `${HOST}/g/p/-/issues/${iid}`,
    created_at: "t",
    updated_at: "t",
    closed_at: null,
  };
}

describe("listIssues", () => {
  it("builds the project-scoped issues URL with required query params", async () => {
    const { impl, calls } = fakeFetch({ body: [] });
    await listIssues(
      { host: HOST, project: "group/project", token: "tok", envVarName: "X", fetchImpl: impl },
      { state: "opened", page: 1, per_page: 20 },
    );
    expect(calls).toHaveLength(1);
    const url = new URL((calls[0] as { url: string }).url);
    expect(url.origin).toBe(HOST);
    expect(url.pathname).toBe("/api/v4/projects/group%2Fproject/issues");
    expect(url.searchParams.get("state")).toBe("opened");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("per_page")).toBe("20");
  });

  it("sends the token via the PRIVATE-TOKEN header", async () => {
    const { impl, calls } = fakeFetch({ body: [] });
    await listIssues(
      { host: HOST, project: "g/p", token: "tok-abc", envVarName: "X", fetchImpl: impl },
      { state: "opened", page: 1, per_page: 20 },
    );
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["PRIVATE-TOKEN"]).toBe("tok-abc");
  });

  it("omits the PRIVATE-TOKEN header when no token is configured", async () => {
    const { impl, calls } = fakeFetch({ body: [] });
    await listIssues(
      { host: HOST, project: "g/p", token: undefined, envVarName: undefined, fetchImpl: impl },
      { state: "opened", page: 1, per_page: 20 },
    );
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["PRIVATE-TOKEN"]).toBeUndefined();
  });

  it("forwards optional filters as query parameters", async () => {
    const { impl, calls } = fakeFetch({ body: [] });
    await listIssues(
      { host: HOST, project: "g/p", token: undefined, envVarName: undefined, fetchImpl: impl },
      {
        state: "opened",
        page: 2,
        per_page: 50,
        labels: "P1,bug",
        assignee: "alice",
        milestone: "v2.0",
        search: "auth",
      },
    );
    const url = new URL((calls[0] as { url: string }).url);
    expect(url.searchParams.get("labels")).toBe("P1,bug");
    expect(url.searchParams.get("assignee_username")).toBe("alice");
    expect(url.searchParams.get("milestone")).toBe("v2.0");
    expect(url.searchParams.get("search")).toBe("auth");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("per_page")).toBe("50");
  });

  it("reads X-Total and X-Total-Pages headers when present", async () => {
    const { impl } = fakeFetch({
      body: [rawIssue(1), rawIssue(2)],
      headers: { "x-total": "47", "x-total-pages": "3" },
    });
    const result = await listIssues(
      { host: HOST, project: "g/p", token: undefined, envVarName: undefined, fetchImpl: impl },
      { state: "opened", page: 1, per_page: 20 },
    );
    expect(result.total).toBe(47);
    expect(result.totalPages).toBe(3);
    expect(result.issues).toHaveLength(2);
  });

  it("returns null totals when GitLab omits the totals headers", async () => {
    const { impl } = fakeFetch({ body: [] });
    const result = await listIssues(
      { host: HOST, project: "g/p", token: undefined, envVarName: undefined, fetchImpl: impl },
      { state: "opened", page: 1, per_page: 20 },
    );
    expect(result.total).toBeNull();
    expect(result.totalPages).toBeNull();
  });

  it("throws ConnectorError on non-OK responses (401 -> auth-failed)", async () => {
    const { impl } = fakeFetch({ status: 401 });
    await expect(
      listIssues(
        { host: HOST, project: "g/p", token: "x", envVarName: "TOK", fetchImpl: impl },
        { state: "opened", page: 1, per_page: 20 },
      ),
    ).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("throws ConnectorError when GitLab returns a non-array body", async () => {
    const { impl } = fakeFetch({ body: { unexpected: "shape" } });
    await expect(
      listIssues(
        { host: HOST, project: "g/p", token: undefined, envVarName: undefined, fetchImpl: impl },
        { state: "opened", page: 1, per_page: 20 },
      ),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe("getIssue", () => {
  it("builds /api/v4/projects/:project/issues/:iid", async () => {
    const { impl, calls } = fakeFetch({ body: rawIssue(482) });
    await getIssue(
      { host: HOST, project: "g/p", token: undefined, envVarName: undefined, fetchImpl: impl },
      482,
    );
    const url = new URL((calls[0] as { url: string }).url);
    expect(url.pathname).toBe("/api/v4/projects/g%2Fp/issues/482");
  });

  it("returns a projected issue object", async () => {
    const { impl } = fakeFetch({ body: rawIssue(1) });
    const issue = await getIssue(
      { host: HOST, project: "g/p", token: undefined, envVarName: undefined, fetchImpl: impl },
      1,
    );
    expect(issue.iid).toBe(1);
    expect(issue.title).toBe("Issue 1");
  });

  it("maps 404 to a not-found ConnectorError that names the iid", async () => {
    const { impl } = fakeFetch({ status: 404 });
    await expect(
      getIssue(
        { host: HOST, project: "g/p", token: undefined, envVarName: undefined, fetchImpl: impl },
        999,
      ),
    ).rejects.toMatchObject({ code: "remote-error" });
  });
});
