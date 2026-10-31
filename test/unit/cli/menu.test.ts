import { describe, expect, it } from "vitest";
import { topLevelMenuOptions } from "../../../src/cli/menu.js";

const values = (hasCitadel: boolean, hasMaester: boolean) =>
  topLevelMenuOptions({ hasCitadel, hasMaester }).map((o) => o.value);

describe("topLevelMenuOptions", () => {
  it("offers only setup on an unconfigured repo", () => {
    expect(values(false, false)).toEqual(["init", "publish", "status", "exit"]);
  });

  it("adds the source verbs when a citadel exists, keeping view/status/exit", () => {
    expect(values(true, false)).toEqual([
      "init",
      "source-add",
      "source-remove",
      "source-list",
      "publish",
      "status",
      "exit",
    ]);
  });

  it("adds the document verbs when a maester manifest exists", () => {
    expect(values(false, true)).toEqual([
      "init",
      "publish",
      "document-add",
      "document-remove",
      "document-list",
      "status",
      "exit",
    ]);
  });

  it("offers all six, labelled by role, when both roles are configured", () => {
    const options = topLevelMenuOptions({ hasCitadel: true, hasMaester: true });
    const edit = options.filter((o) => /-(add|remove|list)$/.test(o.value));
    expect(edit).toHaveLength(6);
    expect(edit.every((o) => /^(Citadel|Maester): /.test(o.label))).toBe(true);
  });
});
