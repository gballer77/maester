import { describe, expect, it } from "vitest";
import {
  GITLAB_ISSUES_DATA_SCHEMA,
  projectIssue,
} from "../../../../../../src/core/connectors/types/gitlab-issues/output.js";

describe("GITLAB_ISSUES_DATA_SCHEMA", () => {
  it("pins the per-type data shape version at 1", () => {
    expect(GITLAB_ISSUES_DATA_SCHEMA).toBe(1);
  });
});

describe("projectIssue", () => {
  it("projects a full GitLab issue object into the stable shape", () => {
    const raw = {
      iid: 42,
      id: 100042,
      title: "Auth refactor",
      description: "Replace JWT lib",
      state: "opened",
      labels: ["P1", "auth"],
      assignees: [{ username: "alice", name: "Alice Example", id: 7, email: "drop@me" }],
      milestone: { title: "v2.0", state: "active", id: 9, due_date: "drop" },
      web_url: "https://gitlab.com/g/p/-/issues/42",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
      closed_at: null,
      // Unknown fields are dropped:
      extra: "ignored",
    };
    expect(projectIssue(raw)).toEqual({
      iid: 42,
      id: 100042,
      title: "Auth refactor",
      description: "Replace JWT lib",
      state: "opened",
      labels: ["P1", "auth"],
      assignees: [{ username: "alice", name: "Alice Example" }],
      milestone: { title: "v2.0", state: "active" },
      web_url: "https://gitlab.com/g/p/-/issues/42",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
      closed_at: null,
    });
  });

  it("returns null for a missing or null description", () => {
    const raw = {
      iid: 1,
      id: 1,
      title: "no desc",
      state: "opened",
      labels: [],
      assignees: [],
      milestone: null,
      web_url: "u",
      created_at: "t",
      updated_at: "t",
      closed_at: null,
    };
    expect(projectIssue(raw).description).toBeNull();
  });

  it("returns [] for missing labels and assignees", () => {
    const raw = {
      iid: 1,
      id: 1,
      title: "t",
      state: "opened",
      milestone: null,
      web_url: "u",
      created_at: "t",
      updated_at: "t",
      closed_at: null,
    };
    const out = projectIssue(raw);
    expect(out.labels).toEqual([]);
    expect(out.assignees).toEqual([]);
  });

  it("returns null milestone when not set", () => {
    const raw = {
      iid: 1,
      id: 1,
      title: "t",
      state: "opened",
      labels: [],
      assignees: [],
      milestone: null,
      web_url: "u",
      created_at: "t",
      updated_at: "t",
      closed_at: null,
    };
    expect(projectIssue(raw).milestone).toBeNull();
  });

  it("preserves closed_at when set", () => {
    const raw = {
      iid: 1,
      id: 1,
      title: "t",
      state: "closed",
      labels: [],
      assignees: [],
      milestone: null,
      web_url: "u",
      created_at: "t",
      updated_at: "t",
      closed_at: "2026-03-01T00:00:00.000Z",
    };
    expect(projectIssue(raw).closed_at).toBe("2026-03-01T00:00:00.000Z");
  });

  it("throws on a missing required string field (title)", () => {
    const raw = {
      iid: 1,
      id: 1,
      state: "opened",
      labels: [],
      assignees: [],
      milestone: null,
      web_url: "u",
      created_at: "t",
      updated_at: "t",
      closed_at: null,
    };
    expect(() => projectIssue(raw)).toThrow(/title/);
  });

  it("throws on non-object input", () => {
    expect(() => projectIssue(null)).toThrow();
    expect(() => projectIssue(42)).toThrow();
  });
});
