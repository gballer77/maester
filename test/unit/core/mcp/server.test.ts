import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __registerTestType } from "../../../../src/core/connectors/registry.js";
import { bootMcpServer } from "../../../../src/core/mcp/server.js";
import {
  TEST_CONNECTOR_TYPE_ID,
  testConnectorType,
} from "../../../fixtures/connector-test-type.js";

let repoRoot: string;
let dispose: () => void;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-mcp-"));
  dispose = __registerTestType(testConnectorType);
});

afterEach(async () => {
  dispose();
  await fs.rm(repoRoot, { recursive: true, force: true });
});

async function writeCitadelYamlWithConnector(): Promise<void> {
  const yaml = `schemaVersion: 1
sources:
  - name: docs
    url: https://example.com/docs.git
connectors:
  - name: echoer
    type: ${TEST_CONNECTOR_TYPE_ID}
    config:
      prefix: hi
`;
  await fs.writeFile(path.join(repoRoot, "citadel.yaml"), yaml, "utf8");
}

describe("bootMcpServer", () => {
  it("returns ok=false with exit 2 when no citadel.yaml is present", async () => {
    const result = await bootMcpServer(repoRoot, "0.0.0-test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.exitCode).toBe(2);
      expect(result.message).toMatch(/citadel\.yaml/);
    }
  });

  it("returns ok=false when the citadel config references an unknown connector type", async () => {
    const yaml = `schemaVersion: 1
sources:
  - name: docs
    url: https://example.com/docs.git
connectors:
  - name: bad
    type: nonexistent
`;
    await fs.writeFile(path.join(repoRoot, "citadel.yaml"), yaml, "utf8");
    const result = await bootMcpServer(repoRoot, "0.0.0-test");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.exitCode).toBe(2);
  });

  it("boots successfully with a valid citadel.yaml and the configured connector tools", async () => {
    await writeCitadelYamlWithConnector();
    const result = await bootMcpServer(repoRoot, "0.0.0-test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 3 operations on the test type × 1 configured connector = 3 tools.
      expect(result.toolCount).toBe(3);
      await result.server.close();
    }
  });
});
