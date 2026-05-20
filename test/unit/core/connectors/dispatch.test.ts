import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findOperationByToolName,
  invokeOperation,
  listConnectorTools,
} from "../../../../src/core/connectors/dispatch.js";
import { __registerTestType } from "../../../../src/core/connectors/registry.js";
import type { CitadelConfig, Connector } from "../../../../src/schemas/citadel.js";
import {
  TEST_CONNECTOR_TYPE_ID,
  testConnectorType,
} from "../../../fixtures/connector-test-type.js";

let disposeType: () => void;

beforeEach(() => {
  disposeType = __registerTestType(testConnectorType);
});

afterEach(() => {
  disposeType();
});

const connector = (overrides: Partial<Connector> = {}): Connector => ({
  name: "echoer",
  type: TEST_CONNECTOR_TYPE_ID,
  config: { prefix: "x" },
  ...overrides,
});

const tokenConnector: Connector = {
  name: "tok",
  type: TEST_CONNECTOR_TYPE_ID,
  auth: { type: "token", envVar: "TEST_DISPATCH_TOKEN" },
  config: {},
};

describe("invokeOperation", () => {
  it("returns a success envelope on a happy-path call", async () => {
    const env = await invokeOperation({
      connector: connector(),
      operationName: "echo",
      args: { message: "hello" },
      env: {},
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.data).toEqual({ said: "x: hello", dataSchema: 1 });
      expect(env.connector).toBe("echoer");
      expect(env.operation).toBe("echo");
    }
  });

  it("returns connector-not-found when the type is unregistered", async () => {
    const env = await invokeOperation({
      connector: { ...connector(), type: "__unknown__" },
      operationName: "echo",
      args: { message: "x" },
      env: {},
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("connector-not-found");
  });

  it("returns unknown-operation when the operation isn't on the type", async () => {
    const env = await invokeOperation({
      connector: connector(),
      operationName: "no-such",
      args: {},
      env: {},
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("unknown-operation");
  });

  it("returns invalid-argument when args fail the operation's argsSchema", async () => {
    const env = await invokeOperation({
      connector: connector(),
      operationName: "echo",
      args: { message: 42 }, // not a string
      env: {},
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("invalid-argument");
  });

  it("returns invalid-argument when per-type config fails the type's configSchema", async () => {
    const env = await invokeOperation({
      connector: { ...connector(), config: { prefix: 123 } },
      operationName: "echo",
      args: { message: "x" },
      env: {},
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("invalid-argument");
  });

  it("returns missing-env-var when token auth references an unset variable", async () => {
    const env = await invokeOperation({
      connector: tokenConnector,
      operationName: "echo",
      args: { message: "x" },
      env: {},
    });
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("missing-env-var");
      expect(env.error.details).toEqual({ envVar: "TEST_DISPATCH_TOKEN" });
    }
  });

  it("passes the resolved token to the handler when the env var is set", async () => {
    const env = await invokeOperation({
      connector: tokenConnector,
      operationName: "echo",
      args: { message: "ok" },
      env: { TEST_DISPATCH_TOKEN: "secret-value" },
    });
    expect(env.ok).toBe(true);
  });

  it("wraps a handler-thrown ConnectorError in the documented failure envelope", async () => {
    const env = await invokeOperation({
      connector: connector(),
      operationName: "fail",
      args: {},
      env: {},
    });
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("remote-error");
      expect(env.error.details).toEqual({ kind: "test" });
    }
  });

  it("maps unexpected handler exceptions to internal-error", async () => {
    const env = await invokeOperation({
      connector: connector(),
      operationName: "boom",
      args: {},
      env: {},
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("internal-error");
  });
});

describe("listConnectorTools", () => {
  const baseConfig: CitadelConfig = {
    schemaVersion: 1,
    sources: [],
    connectors: [
      { name: "a", type: TEST_CONNECTOR_TYPE_ID, config: {} },
      { name: "b", type: TEST_CONNECTOR_TYPE_ID, config: { prefix: "b" }, description: "B note." },
    ],
  };

  it("returns one descriptor per (connector, operation) pair with normalized names", () => {
    const tools = listConnectorTools(baseConfig);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["a__boom", "a__echo", "a__fail", "b__boom", "b__echo", "b__fail"]);
  });

  it("prepends the connector entry's description when set", () => {
    const tools = listConnectorTools(baseConfig);
    const bEcho = tools.find((t) => t.name === "b__echo");
    expect(bEcho?.description.startsWith("B note. ")).toBe(true);
    const aEcho = tools.find((t) => t.name === "a__echo");
    expect(aEcho?.description.startsWith("Test echo operation")).toBe(true);
  });

  it("supplies an inputSchema per tool", () => {
    const tools = listConnectorTools(baseConfig);
    const aEcho = tools.find((t) => t.name === "a__echo");
    expect((aEcho?.inputSchema as { type: string }).type).toBe("object");
  });
});

describe("findOperationByToolName", () => {
  it("resolves a normalized tool name back to its connector and operation", () => {
    const config: CitadelConfig = {
      schemaVersion: 1,
      sources: [],
      connectors: [{ name: "team-gl", type: TEST_CONNECTOR_TYPE_ID, config: {} }],
    };
    const match = findOperationByToolName(config, "team_gl__echo");
    expect(match?.connector.name).toBe("team-gl");
    expect(match?.operationName).toBe("echo");
  });

  it("returns undefined for an unknown tool name", () => {
    expect(
      findOperationByToolName({ schemaVersion: 1, sources: [] }, "does__not_exist"),
    ).toBeUndefined();
  });
});
