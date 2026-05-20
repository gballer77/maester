import type { ConnectorType } from "../../types.js";
import { getIssueOperation, listIssuesOperation } from "./operations.js";
import type { GitLabIssuesConfig } from "./schema.js";
import { GitLabIssuesConfigSchema } from "./schema.js";

export const GITLAB_ISSUES_TYPE_ID = "gitlab-issues" as const;

export const gitlabIssuesType: ConnectorType<GitLabIssuesConfig> = {
  id: GITLAB_ISSUES_TYPE_ID,
  label: "GitLab Issues",
  configSchema: GitLabIssuesConfigSchema,
  operations: {
    [listIssuesOperation.name]: listIssuesOperation,
    [getIssueOperation.name]: getIssueOperation,
  },
  describeTool: (operation, resolvedConfig) => {
    const host = stripScheme(resolvedConfig.host);
    const project = resolvedConfig.project;
    switch (operation.name) {
      case "list-issues":
        return `List GitLab issues for project ${project} on ${host}. Supports filtering by state (opened/closed/all), labels, assignee, milestone, free-text search, and page/per_page pagination. Returns at most 100 issues per call.`;
      case "get-issue":
        return `Fetch a single GitLab issue from project ${project} on ${host} by its project-scoped iid. Returns the issue's title, description, state, labels, assignees, milestone, timestamps, and web_url.`;
      default:
        return `GitLab Issues operation '${operation.name}' for project ${project} on ${host}.`;
    }
  },
};

function stripScheme(host: string): string {
  return host.replace(/^https?:\/\//i, "");
}
