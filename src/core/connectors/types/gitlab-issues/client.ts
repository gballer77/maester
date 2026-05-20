import { ConnectorError } from "../../errors.js";
import { mapGitLabHttpError, mapTransportError } from "./errors.js";
import { type IssueOutput, projectIssue } from "./output.js";

/**
 * Thin native-`fetch` facade over GitLab's REST API. v1 supports the two
 * issue endpoints we expose as MCP tools; no SDK dependency.
 *
 * Per Gap 45: a `project` value that is all digits is treated as a numeric
 * project ID and passed verbatim; anything else is URL-encoded as a path.
 */
const NUMERIC_ID_RE = /^\d+$/;

export type GitLabClientOptions = {
  host: string;
  project: string;
  /** Personal access token; when undefined, the request is made without auth. */
  token: string | undefined;
  /** Env-var name surfaced in 401/403 error messages. Pure UX. */
  envVarName: string | undefined;
  /** Override fetch for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

export type ListIssuesParams = {
  state: "opened" | "closed" | "all";
  labels?: string;
  assignee?: string;
  milestone?: string;
  search?: string;
  page: number;
  per_page: number;
};

export type ListIssuesResponse = {
  issues: IssueOutput[];
  /** From `X-Total-Pages` header; null when GitLab omits the header. */
  totalPages: number | null;
  /** From `X-Total` header; null when GitLab omits the header. */
  total: number | null;
};

/**
 * GET /api/v4/projects/:project/issues
 */
export async function listIssues(
  opts: GitLabClientOptions,
  params: ListIssuesParams,
): Promise<ListIssuesResponse> {
  const url = buildIssuesListUrl(opts, params);
  const response = await performRequest(opts, url);
  const issuesRaw = (await response.json()) as unknown;
  if (!Array.isArray(issuesRaw)) {
    throw new ConnectorError("remote-error", "GitLab list-issues response was not a JSON array.", {
      kind: "unexpected",
    });
  }
  const issues = issuesRaw.map((raw) => projectIssue(raw));
  return {
    issues,
    totalPages: readIntegerHeader(response.headers, "x-total-pages"),
    total: readIntegerHeader(response.headers, "x-total"),
  };
}

/**
 * GET /api/v4/projects/:project/issues/:iid
 */
export async function getIssue(opts: GitLabClientOptions, iid: number): Promise<IssueOutput> {
  const url = buildIssueUrl(opts, iid);
  const response = await performRequest(opts, url, { iid });
  const raw = (await response.json()) as unknown;
  return projectIssue(raw);
}

function buildIssuesListUrl(opts: GitLabClientOptions, params: ListIssuesParams): URL {
  const url = new URL(`${opts.host}/api/v4/projects/${encodeProjectSegment(opts.project)}/issues`);
  url.searchParams.set("state", params.state);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("per_page", String(params.per_page));
  if (params.labels !== undefined) url.searchParams.set("labels", params.labels);
  if (params.assignee !== undefined) {
    const param = gitlabAssigneeParam(params.assignee);
    url.searchParams.set(param.key, param.value);
  }
  if (params.milestone !== undefined) url.searchParams.set("milestone", params.milestone);
  if (params.search !== undefined) url.searchParams.set("search", params.search);
  return url;
}

function buildIssueUrl(opts: GitLabClientOptions, iid: number): URL {
  return new URL(
    `${opts.host}/api/v4/projects/${encodeProjectSegment(opts.project)}/issues/${iid}`,
  );
}

/**
 * Encode the project identifier for use in a URL path segment.
 *
 * Per the framework architecture (Gap 45): purely-numeric values are treated
 * as project IDs and used verbatim; anything else is URL-encoded as a path
 * (forward slashes become `%2F`).
 */
export function encodeProjectSegment(project: string): string {
  if (NUMERIC_ID_RE.test(project)) return project;
  return encodeURIComponent(project);
}

async function performRequest(
  opts: GitLabClientOptions,
  url: URL,
  context: { iid?: number } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (opts.token !== undefined) {
    headers["PRIVATE-TOKEN"] = opts.token;
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", headers });
  } catch (err) {
    throw mapTransportError(err, opts.host);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw mapGitLabHttpError({
      status: response.status,
      body,
      headers: response.headers,
      host: opts.host,
      envVarName: opts.envVarName,
      context: {
        project: opts.project,
        ...(context.iid !== undefined ? { iid: context.iid } : {}),
      },
    });
  }
  return response;
}

function readIntegerHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.length === 0) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * GitLab's `assignee_username` and `assignee_id` parameters accept the
 * special values `None` and `Any` via the singular form. We surface the
 * detail to callers via a small mapping so the agent-facing schema can use
 * the simpler `assignee` argument name.
 */
function gitlabAssigneeParam(value: string): { key: string; value: string } {
  return { key: "assignee_username", value };
}
