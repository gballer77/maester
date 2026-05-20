import { z } from "zod";
import { defineConnectorOperation } from "../../types.js";
import { type GitLabClientOptions, type ListIssuesParams, getIssue, listIssues } from "./client.js";
import { GITLAB_ISSUES_DATA_SCHEMA, type GetIssueData, type ListIssuesData } from "./output.js";
import type { GitLabIssuesConfig } from "./schema.js";

/**
 * Hard cap on `per_page`. GitLab's documented maximum is 100; values above
 * are clamped (with `meta.clamped = true`).
 */
export const PER_PAGE_CAP = 100;

const listIssuesArgsSchema = z
  .object({
    state: z.enum(["opened", "closed", "all"]).default("opened"),
    labels: z.string().min(1).optional(),
    assignee: z.string().min(1).optional(),
    milestone: z.string().min(1).optional(),
    search: z.string().min(1).optional(),
    page: z.coerce.number().int().positive("page must be a positive integer").default(1),
    per_page: z.coerce.number().int().positive("per_page must be a positive integer").default(20),
  })
  .strict();

const getIssueArgsSchema = z
  .object({
    iid: z.coerce.number().int().positive("iid must be a positive integer"),
  })
  .strict();

type ListIssuesArgs = z.infer<typeof listIssuesArgsSchema>;
type GetIssueArgs = z.infer<typeof getIssueArgsSchema>;

export const listIssuesOperation = defineConnectorOperation<
  GitLabIssuesConfig,
  ListIssuesArgs,
  ListIssuesData
>({
  name: "list-issues",
  argsSchema: listIssuesArgsSchema,
  dataSchemaVersion: GITLAB_ISSUES_DATA_SCHEMA,
  handler: async (args, ctx) => {
    const requestedPerPage = args.per_page;
    const clamped = requestedPerPage > PER_PAGE_CAP;
    const effectivePerPage = clamped ? PER_PAGE_CAP : requestedPerPage;
    const params: ListIssuesParams = {
      state: args.state,
      page: args.page,
      per_page: effectivePerPage,
      ...(args.labels !== undefined ? { labels: args.labels } : {}),
      ...(args.assignee !== undefined ? { assignee: args.assignee } : {}),
      ...(args.milestone !== undefined ? { milestone: args.milestone } : {}),
      ...(args.search !== undefined ? { search: args.search } : {}),
    };
    const client = clientFromContext(ctx);
    const response = await listIssues(client, params);
    return {
      data: {
        issues: response.issues,
        meta: {
          page: args.page,
          per_page: effectivePerPage,
          total_pages: response.totalPages,
          total: response.total,
          clamped,
        },
      },
    };
  },
});

export const getIssueOperation = defineConnectorOperation<
  GitLabIssuesConfig,
  GetIssueArgs,
  GetIssueData
>({
  name: "get-issue",
  argsSchema: getIssueArgsSchema,
  dataSchemaVersion: GITLAB_ISSUES_DATA_SCHEMA,
  handler: async (args, ctx) => {
    const client = clientFromContext(ctx);
    const issue = await getIssue(client, args.iid);
    return { data: { issue } };
  },
});

/**
 * Build the per-request client options bag from the dispatcher's context.
 * The dispatcher already resolved the per-type config and auth; we just
 * thread them through.
 */
function clientFromContext(ctx: {
  config: GitLabIssuesConfig;
  token: string | undefined;
  auth: { type: "delegated" } | { type: "token"; value: string; envVar: string };
}): GitLabClientOptions {
  return {
    host: ctx.config.host,
    project: ctx.config.project,
    token: ctx.token,
    envVarName: ctx.auth.type === "token" ? ctx.auth.envVar : undefined,
  };
}

/**
 * For tests that want to wire in a fetch mock without exporting the whole
 * dispatcher path. Production code goes through `invokeOperation` and never
 * calls this.
 */
export function __clientFromConfigForTests(
  config: GitLabIssuesConfig,
  token: string | undefined,
  envVarName: string | undefined,
  fetchImpl?: typeof fetch,
): GitLabClientOptions {
  return {
    host: config.host,
    project: config.project,
    token,
    envVarName,
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}

// Surface the args schemas so tests can validate against them.
export {
  listIssuesArgsSchema as listIssuesArgsSchemaForTests,
  getIssueArgsSchema as getIssueArgsSchemaForTests,
};
