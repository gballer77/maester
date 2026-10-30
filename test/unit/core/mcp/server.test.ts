import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __registerTestType } from "../../../../src/core/connectors/registry.js";
import { createMcpServer as bootMcpServer } from "../../../../src/core/mcp/server.js";
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

  it("adds the two linked-document tools only when a link-mode destination exists", async () => {
    await writeCitadelYamlWithConnector();
    const dest = path.join(repoRoot, "citadel/docs");
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(
      path.join(dest, ".maester-source.json"),
      JSON.stringify({
        markerVersion: 2,
        kind: "path",
        sourceName: "docs",
        sourcePath: "../docs",
        fingerprint: "sha256:x",
        mode: "link",
        filterSet: ["**"],
      }),
      "utf8",
    );
    const result = await bootMcpServer(repoRoot, "0.0.0-test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.toolCount).toBe(5);
      await result.server.close();
    }
  });
});

describe("createMcpServer — proxied MCP servers", () => {
  it("lists connector tools then proxied tools, and routes calls to the upstream", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { STDIO_UPSTREAM } = await import("../../../helpers/mcp-upstreams.js");
    const yaml = `schemaVersion: 1
sources:
  - name: docs
    url: https://example.com/docs.git
connectors:
  - name: echoer
    type: ${TEST_CONNECTOR_TYPE_ID}
    config:
      prefix: hi
mcpServers:
  - name: code-host
    kind: local
    command: ${JSON.stringify(process.execPath)}
    args: [${JSON.stringify(STDIO_UPSTREAM)}, "--tools", "search"]
  - name: broken
    kind: local
    command: ${JSON.stringify(process.execPath)}
    envVars: [NOT_SET_ANYWHERE]
`;
    await fs.writeFile(path.join(repoRoot, "citadel.yaml"), yaml, "utf8");
    const logs: string[] = [];
    const created = await bootMcpServer(repoRoot, "0.0.0-test", {
      env: {},
      log: (l) => logs.push(l),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await created.server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names.slice(0, 3).every((n) => n.startsWith("echoer__"))).toBe(true);
      expect(names.slice(3)).toEqual(["code_host__search"]);
      const result = await client.callTool({ name: "code_host__search", arguments: { text: "q" } });
      expect(JSON.parse((result.content as { text: string }[])[0]?.text ?? "")).toEqual({
        tool: "search",
        args: { text: "q" },
      });
      expect(logs).toContain("[mcp-server:broken] failed: missing-env-var NOT_SET_ANYWHERE");
    } finally {
      await client.close();
      await created.pool.shutdown();
    }
  }, 20_000);
});
