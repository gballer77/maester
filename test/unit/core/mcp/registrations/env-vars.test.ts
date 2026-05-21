import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectConnectorEnvVars,
  loadConnectorEnvVarsBestEffort,
} from "../../../../../src/core/mcp/registrations/env-vars.js";
import type { Connector } from "../../../../../src/schemas/citadel.js";

function tokenConnector(name: string, envVar: string): Connector {
  return {
    name,
    type: "gitlab-issues",
    auth: { type: "token", envVar },
    config: { project: "g/p" },
  } as Connector;
}

function noneConnector(name: string): Connector {
  return { name, type: "gitlab-issues", auth: { type: "none" } } as Connector;
}

describe("collectConnectorEnvVars", () => {
  it("returns empty when given undefined or an empty array", () => {
    expect(collectConnectorEnvVars(undefined)).toEqual({ managed: [], invalid: [] });
    expect(collectConnectorEnvVars([])).toEqual({ managed: [], invalid: [] });
  });

  it("returns the sorted, deduped env-var names for token-auth connectors", () => {
    const result = collectConnectorEnvVars([
      tokenConnector("c", "ZULIP_TOKEN"),
      tokenConnector("a", "GITLAB_TOKEN"),
      tokenConnector("b", "GITLAB_TOKEN"),
    ]);
    expect(result.managed).toEqual(["GITLAB_TOKEN", "ZULIP_TOKEN"]);
    expect(result.invalid).toEqual([]);
  });

  it("ignores connectors with no auth or auth.type === 'none'", () => {
    const result = collectConnectorEnvVars([
      noneConnector("a"),
      tokenConnector("b", "GITLAB_TOKEN"),
    ]);
    expect(result.managed).toEqual(["GITLAB_TOKEN"]);
  });

  it("collects malformed env-var names as invalid and excludes them from managed", () => {
    const result = collectConnectorEnvVars([
      tokenConnector("ok", "GOOD_TOKEN"),
      // Lowercase first char fails ENV_VAR_RE (/^[A-Z][A-Z0-9_]*$/)
      tokenConnector("bad", "bad token"),
    ]);
    expect(result.managed).toEqual(["GOOD_TOKEN"]);
    expect(result.invalid).toEqual([{ connector: "bad", envVar: "bad token" }]);
  });

  it("dedupes connectors that share the same env-var name", () => {
    const result = collectConnectorEnvVars([
      tokenConnector("a", "SHARED"),
      tokenConnector("b", "SHARED"),
      tokenConnector("c", "OTHER"),
    ]);
    expect(result.managed).toEqual(["OTHER", "SHARED"]);
  });
});

describe("loadConnectorEnvVarsBestEffort", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-env-vars-load-"));
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it("returns empty when citadel.yaml is missing — no loadError", async () => {
    const result = await loadConnectorEnvVarsBestEffort(repoRoot);
    expect(result.managed).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.loadError).toBeUndefined();
  });

  it("reads connector env-var names from a valid citadel.yaml", async () => {
    await fs.writeFile(
      path.join(repoRoot, "citadel.yaml"),
      [
        "schemaVersion: 1",
        "sources:",
        "  - name: a",
        "    url: https://github.com/x/y",
        "connectors:",
        "  - name: gl",
        "    type: gitlab-issues",
        "    auth:",
        "      type: token",
        "      envVar: GITLAB_TOKEN",
        "    config:",
        "      project: g/p",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await loadConnectorEnvVarsBestEffort(repoRoot);
    expect(result.managed).toEqual(["GITLAB_TOKEN"]);
    expect(result.invalid).toEqual([]);
    expect(result.loadError).toBeUndefined();
  });

  it("returns a loadError when citadel.yaml is malformed instead of throwing", async () => {
    await fs.writeFile(
      path.join(repoRoot, "citadel.yaml"),
      "schemaVersion: 1\nconnectors: not-an-array\n",
      "utf8",
    );
    const result = await loadConnectorEnvVarsBestEffort(repoRoot);
    expect(result.managed).toEqual([]);
    expect(result.loadError).toBeDefined();
  });
});
