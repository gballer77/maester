import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCitadelConfig, loadMaesterConfig } from "../../../../src/core/config/loader.js";
import { ConfigError } from "../../../../src/core/errors.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

const VALID_CITADEL = `schemaVersion: 1
sources:
  - name: design-system
    url: https://github.com/example/design-system.git
    ref: main
`;

const VALID_MAESTER = `schemaVersion: 1
documents:
  - path: README.md
    category: readme
`;

let repo: TempRepo;
beforeEach(async () => {
  repo = await makeTmpRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("loadCitadelConfig", () => {
  it("loads and parses a valid citadel.yaml", async () => {
    await writeFile(repo.resolve("citadel.yaml"), VALID_CITADEL, "utf8");
    const config = await loadCitadelConfig(repo.path);
    expect(config.schemaVersion).toBe(1);
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]?.name).toBe("design-system");
  });

  it("throws ConfigError when the file is missing", async () => {
    await expect(loadCitadelConfig(repo.path)).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError with line info on YAML syntax errors", async () => {
    await writeFile(
      repo.resolve("citadel.yaml"),
      "schemaVersion: 1\nsources:\n  - name: x\n  url: missing-leading-dash\n",
      "utf8",
    );
    let caught: unknown;
    try {
      await loadCitadelConfig(repo.path);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on schema violations with field path", async () => {
    await writeFile(repo.resolve("citadel.yaml"), "schemaVersion: 1\nsources: []\n", "utf8");
    let caught: ConfigError | undefined;
    try {
      await loadCitadelConfig(repo.path);
    } catch (e) {
      caught = e as ConfigError;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught?.message).toMatch(/source/i);
  });
});

describe("loadMaesterConfig", () => {
  it("loads and parses a valid maester.yaml", async () => {
    await writeFile(repo.resolve("maester.yaml"), VALID_MAESTER, "utf8");
    const config = await loadMaesterConfig(repo.path);
    expect(config.documents[0]?.path).toBe("README.md");
  });

  it("throws ConfigError when the file is missing", async () => {
    await expect(loadMaesterConfig(repo.path)).rejects.toBeInstanceOf(ConfigError);
  });
});
