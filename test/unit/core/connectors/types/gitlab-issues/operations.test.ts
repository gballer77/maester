import { describe, expect, it } from "vitest";
import {
  getIssueArgsSchemaForTests,
  listIssuesArgsSchemaForTests,
} from "../../../../../../src/core/connectors/types/gitlab-issues/operations.js";

describe("list-issues args schema", () => {
  const schema = listIssuesArgsSchemaForTests;

  it("defaults state to 'opened', page to 1, per_page to 20", () => {
    const parsed = schema.parse({});
    expect(parsed.state).toBe("opened");
    expect(parsed.page).toBe(1);
    expect(parsed.per_page).toBe(20);
  });

  it("accepts the documented enum values for state", () => {
    expect(schema.parse({ state: "opened" }).state).toBe("opened");
    expect(schema.parse({ state: "closed" }).state).toBe("closed");
    expect(schema.parse({ state: "all" }).state).toBe("all");
  });

  it("rejects an unknown state value", () => {
    const result = schema.safeParse({ state: "draft" });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive page or per_page", () => {
    expect(schema.safeParse({ page: 0 }).success).toBe(false);
    expect(schema.safeParse({ page: -1 }).success).toBe(false);
    expect(schema.safeParse({ per_page: 0 }).success).toBe(false);
  });

  it("coerces numeric strings to numbers (so CLI flags pass through)", () => {
    const parsed = schema.parse({ page: "3", per_page: "50" });
    expect(parsed.page).toBe(3);
    expect(parsed.per_page).toBe(50);
  });

  it("rejects unknown fields (strict schema)", () => {
    const result = schema.safeParse({ wat: "huh" });
    expect(result.success).toBe(false);
  });
});

describe("get-issue args schema", () => {
  const schema = getIssueArgsSchemaForTests;

  it("requires iid", () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a positive integer iid", () => {
    expect(schema.parse({ iid: 482 }).iid).toBe(482);
  });

  it("coerces a numeric-string iid", () => {
    expect(schema.parse({ iid: "12" }).iid).toBe(12);
  });

  it("rejects a non-integer iid", () => {
    expect(schema.safeParse({ iid: 1.5 }).success).toBe(false);
  });

  it("rejects a zero or negative iid", () => {
    expect(schema.safeParse({ iid: 0 }).success).toBe(false);
    expect(schema.safeParse({ iid: -3 }).success).toBe(false);
  });

  it("rejects unknown fields (strict schema)", () => {
    expect(schema.safeParse({ iid: 1, wat: "huh" }).success).toBe(false);
  });
});
