import { describe, expect, it } from "vitest";
import { lookupConnectorType } from "../../../../../../src/core/connectors/registry.js";
import {
  GITLAB_ISSUES_TYPE_ID,
  gitlabIssuesType,
} from "../../../../../../src/core/connectors/types/gitlab-issues/index.js";

describe("gitlab-issues connector type", () => {
  it("is registered in the production registry under the documented id", () => {
    const found = lookupConnectorType(GITLAB_ISSUES_TYPE_ID);
    expect(found).toBeDefined();
    expect(found?.id).toBe("gitlab-issues");
  });

  it("exposes list-issues and get-issue as named operations", () => {
    expect(Object.keys(gitlabIssuesType.operations).sort()).toEqual(["get-issue", "list-issues"]);
  });

  it("describes list-issues with the resolved host and project", () => {
    const desc = gitlabIssuesType.describeTool(
      gitlabIssuesType.operations["list-issues"] as never,
      { host: "https://gitlab.acme.internal", project: "team/repo", apiVersion: 4 },
    );
    expect(desc).toContain("team/repo");
    expect(desc).toContain("gitlab.acme.internal");
    expect(desc).not.toContain("https://");
  });

  it("describes get-issue with the resolved host and project", () => {
    const desc = gitlabIssuesType.describeTool(gitlabIssuesType.operations["get-issue"] as never, {
      host: "https://gitlab.com",
      project: "g/p",
      apiVersion: 4,
    });
    expect(desc).toContain("g/p");
    expect(desc).toContain("gitlab.com");
  });
});
