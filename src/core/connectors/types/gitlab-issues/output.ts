/**
 * Per-type data shape version embedded in success payloads from this connector.
 * Increments only on incompatible changes to the issue object shape or the
 * list-issues `meta` shape. Independent of the framework's envelope schema.
 */
export const GITLAB_ISSUES_DATA_SCHEMA = 1 as const;

export type IssueAssignee = {
  username: string;
  name: string;
};

export type IssueMilestone = {
  title: string;
  state: string;
};

/**
 * Stable, versioned subset of the GitLab Issue object surfaced to agents.
 * Fields not listed here are intentionally dropped — adding fields is additive
 * and does NOT require a `dataSchema` bump; removing or renaming any field
 * DOES require a bump.
 */
export type IssueOutput = {
  iid: number;
  id: number;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  assignees: IssueAssignee[];
  milestone: IssueMilestone | null;
  web_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type ListIssuesMeta = {
  page: number;
  per_page: number;
  total_pages: number | null;
  total: number | null;
  clamped: boolean;
};

export type ListIssuesData = {
  issues: IssueOutput[];
  meta: ListIssuesMeta;
};

export type GetIssueData = {
  issue: IssueOutput;
};

/**
 * Map a raw GitLab issue object to the framework's stable IssueOutput shape.
 * Unknown fields are dropped; nullable fields default to `null`.
 */
export function projectIssue(raw: unknown): IssueOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Expected GitLab issue payload to be a JSON object.");
  }
  const r = raw as Record<string, unknown>;
  return {
    iid: requireNumber(r.iid, "iid"),
    id: requireNumber(r.id, "id"),
    title: requireString(r.title, "title"),
    description: optionalString(r.description),
    state: requireString(r.state, "state"),
    labels: projectLabels(r.labels),
    assignees: projectAssignees(r.assignees),
    milestone: projectMilestone(r.milestone),
    web_url: requireString(r.web_url, "web_url"),
    created_at: requireString(r.created_at, "created_at"),
    updated_at: requireString(r.updated_at, "updated_at"),
    closed_at: optionalString(r.closed_at),
  };
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected GitLab issue field '${field}' to be a number.`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected GitLab issue field '${field}' to be a string.`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return value;
}

function projectLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v);
}

function projectAssignees(value: unknown): IssueAssignee[] {
  if (!Array.isArray(value)) return [];
  const out: IssueAssignee[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const username = typeof r.username === "string" ? r.username : null;
    const name = typeof r.name === "string" ? r.name : null;
    if (username === null || name === null) continue;
    out.push({ username, name });
  }
  return out;
}

function projectMilestone(value: unknown): IssueMilestone | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title : null;
  const state = typeof r.state === "string" ? r.state : null;
  if (title === null || state === null) return null;
  return { title, state };
}
