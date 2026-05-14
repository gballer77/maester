import { describe, expect, it } from "vitest";
import { buildPublishedDocumentStateField } from "../../../../src/cli/commands/publish.js";

describe("buildPublishedDocumentStateField", () => {
  it("omits the state field when the user picks 'file header'", () => {
    expect(buildPublishedDocumentStateField("file-header")).toEqual({});
  });

  it("emits { state: 'draft' } when the user picks 'draft'", () => {
    expect(buildPublishedDocumentStateField("draft")).toEqual({ state: "draft" });
  });

  it("emits { state: 'canon' } when the user picks 'canon'", () => {
    expect(buildPublishedDocumentStateField("canon")).toEqual({ state: "canon" });
  });
});
