import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectRoles } from "../../../../src/core/config/paths.js";
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
