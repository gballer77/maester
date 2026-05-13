import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultDestinationFor, detectRoles } from "../../../../src/core/config/paths.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("detectRoles", () => {
  it("reports neither role for a fresh repo", () => {
    expect(detectRoles(repo.path)).toEqual({ hasCitadel: false, hasMaester: false });
  });

  it("reports hasCitadel=true when citadel.yaml exists", async () => {
    await writeFile(repo.resolve("citadel.yaml"), "schemaVersion: 1\n", "utf8");
    expect(detectRoles(repo.path).hasCitadel).toBe(true);
  });

  it("reports hasMaester=true when maester.yaml exists", async () => {
    await writeFile(repo.resolve("maester.yaml"), "schemaVersion: 1\n", "utf8");
    expect(detectRoles(repo.path).hasMaester).toBe(true);
  });

  it("reports both roles when both files exist", async () => {
    await writeFile(repo.resolve("citadel.yaml"), "schemaVersion: 1\n", "utf8");
    await writeFile(repo.resolve("maester.yaml"), "schemaVersion: 1\n", "utf8");
    expect(detectRoles(repo.path)).toEqual({ hasCitadel: true, hasMaester: true });
  });
});

describe("defaultDestinationFor", () => {
  it("uses 'citadel/<name>' when baseDir is omitted", () => {
    expect(defaultDestinationFor("/repo", "design-system")).toBe(
      resolve("/repo", "citadel", "design-system"),
    );
  });

  it("uses 'citadel/<name>' when baseDir is undefined", () => {
    expect(defaultDestinationFor("/repo", "design-system", undefined)).toBe(
      resolve("/repo", "citadel", "design-system"),
    );
  });

  it("respects an explicit baseDir", () => {
    expect(defaultDestinationFor("/repo", "design-system", "vendor")).toBe(
      resolve("/repo", "vendor", "design-system"),
    );
  });

  it("respects a nested baseDir", () => {
    expect(defaultDestinationFor("/repo", "design-system", "docs/external")).toBe(
      resolve("/repo", "docs/external", "design-system"),
    );
  });
});
