import { describe, expect, it } from "vitest";
import {
  GITLAB_DEFAULT_HOST,
  GitLabIssuesConfigSchema,
} from "../../../../../../src/core/connectors/types/gitlab-issues/schema.js";

describe("GitLabIssuesConfigSchema", () => {
  it("requires `project`", () => {
    const result = GitLabIssuesConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("defaults host to gitlab.com when omitted", () => {
    const result = GitLabIssuesConfigSchema.parse({ project: "my-group/my-project" });
    expect(result.host).toBe(GITLAB_DEFAULT_HOST);
    expect(result.project).toBe("my-group/my-project");
    expect(result.apiVersion).toBe(4);
  });

  it("accepts an explicit HTTPS host", () => {
    const result = GitLabIssuesConfigSchema.parse({
      host: "https://gitlab.example.com",
      project: "acme/widgets/widgets-core",
    });
    expect(result.host).toBe("https://gitlab.example.com");
  });

  it("strips a trailing slash from host so URL concat doesn't double up", () => {
    const result = GitLabIssuesConfigSchema.parse({
      host: "https://gitlab.example.com/",
      project: "g/p",
    });
    expect(result.host).toBe("https://gitlab.example.com");
  });

  it("rejects an http:// host (HTTPS only in v1)", () => {
    const result = GitLabIssuesConfigSchema.safeParse({
      host: "http://gitlab.example.com",
      project: "g/p",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed host", () => {
    const result = GitLabIssuesConfigSchema.safeParse({
      host: "not-a-url",
      project: "g/p",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a project containing whitespace", () => {
    const result = GitLabIssuesConfigSchema.safeParse({ project: "group with space/proj" });
    expect(result.success).toBe(false);
  });

  it("accepts a numeric project ID", () => {
    const result = GitLabIssuesConfigSchema.parse({ project: "12345" });
    expect(result.project).toBe("12345");
  });

  it("rejects unknown top-level fields (strict schema)", () => {
    const result = GitLabIssuesConfigSchema.safeParse({
      project: "g/p",
      extra: "field",
    });
    expect(result.success).toBe(false);
  });
});
