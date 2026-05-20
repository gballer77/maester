import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __registerTestType } from "../../../../src/core/connectors/registry.js";
import {
  ConnectorNotFoundError,
  DuplicateConnectorError,
  addConnectorToCitadel,
  listConnectorsFromCitadel,
  removeConnectorFromCitadel,
} from "../../../../src/core/init/connector-writer.js";
import {
  TEST_CONNECTOR_TYPE_ID,
  testConnectorType,
} from "../../../fixtures/connector-test-type.js";

let repoRoot: string;
let dispose: () => void;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-cw-"));
  dispose = __registerTestType(testConnectorType);
});

afterEach(async () => {
  dispose();
  await fs.rm(repoRoot, { recursive: true, force: true });
});

async function seedCitadel(connectors?: string): Promise<void> {
  const yaml = `schemaVersion: 1
sources:
  - name: docs
    url: https://example.com/docs.git
${connectors ?? ""}`;
  await fs.writeFile(path.join(repoRoot, "citadel.yaml"), yaml, "utf8");
}

describe("addConnectorToCitadel", () => {
  it("appends a new connector and writes citadel.yaml", async () => {
    await seedCitadel();
    const result = await addConnectorToCitadel(repoRoot, {
      name: "echoer",
      type: TEST_CONNECTOR_TYPE_ID,
      config: { prefix: "x" },
    });
    expect(result.config.connectors).toHaveLength(1);
    expect(result.config.connectors?.[0]?.name).toBe("echoer");
    const text = await fs.readFile(path.join(repoRoot, "citadel.yaml"), "utf8");
    expect(text).toContain("connectors:");
    expect(text).toContain("echoer");
  });

  it("rejects a duplicate name with DuplicateConnectorError", async () => {
    await seedCitadel(`connectors:
  - name: echoer
    type: ${TEST_CONNECTOR_TYPE_ID}
    config: {}
`);
    await expect(
      addConnectorToCitadel(repoRoot, {
        name: "echoer",
        type: TEST_CONNECTOR_TYPE_ID,
        config: {},
      }),
    ).rejects.toBeInstanceOf(DuplicateConnectorError);
  });
});

describe("removeConnectorFromCitadel", () => {
  it("deletes the matching entry and writes citadel.yaml", async () => {
    await seedCitadel(`connectors:
  - name: keep
    type: ${TEST_CONNECTOR_TYPE_ID}
    config: {}
  - name: drop
    type: ${TEST_CONNECTOR_TYPE_ID}
    config: {}
`);
    const result = await removeConnectorFromCitadel(repoRoot, "drop");
    expect(result.config.connectors?.map((c) => c.name)).toEqual(["keep"]);
    const text = await fs.readFile(path.join(repoRoot, "citadel.yaml"), "utf8");
    expect(text).not.toContain("name: drop");
  });

  it("throws ConnectorNotFoundError on a missing name", async () => {
    await seedCitadel();
    await expect(removeConnectorFromCitadel(repoRoot, "missing")).rejects.toBeInstanceOf(
      ConnectorNotFoundError,
    );
  });
});

describe("listConnectorsFromCitadel", () => {
  it("returns the empty array when none are declared", async () => {
    await seedCitadel();
    expect(await listConnectorsFromCitadel(repoRoot)).toEqual([]);
  });

  it("returns the configured connectors verbatim", async () => {
    await seedCitadel(`connectors:
  - name: a
    type: ${TEST_CONNECTOR_TYPE_ID}
    config: {}
  - name: b
    type: ${TEST_CONNECTOR_TYPE_ID}
    description: "B"
    config:
      prefix: hi
`);
    const list = await listConnectorsFromCitadel(repoRoot);
    expect(list.map((c) => c.name)).toEqual(["a", "b"]);
    expect(list[1]?.description).toBe("B");
  });
});
