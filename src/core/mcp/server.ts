import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadCitadelConfig } from "../config/loader.js";
import {
  findOperationByToolName,
  invokeOperation,
  listConnectorTools,
} from "../connectors/dispatch.js";
import { type FailureInput, buildFailureEnvelope } from "../connectors/envelope.js";
import { ConfigError } from "../errors.js";
import { setupStdioForMcp } from "./transport.js";

export const MCP_SERVER_NAME = "maester";

export type McpBootResult =
  | { ok: true; toolCount: number; server: Server }
  | { ok: false; exitCode: number; message: string };

/**
 * Boot the stdio-based MCP server for the citadel at `repoRoot`. On a fatal
 * startup failure (no citadel.yaml, invalid config, unknown connector type)
 * the function returns `{ ok: false }` so the CLI command can write the
 * message to stderr and exit non-zero — the server is never partially up.
 *
 * On success, `connect()` is invoked with `StdioServerTransport` and the
 * function resolves. The process keeps running until the host closes stdin.
 */
export async function bootMcpServer(
  repoRoot: string,
  serverVersion: string,
): Promise<McpBootResult> {
  // Make sure no shared-logger writes corrupt the JSON-RPC stream.
  setupStdioForMcp();

  let citadelConfig: Awaited<ReturnType<typeof loadCitadelConfig>>;
  try {
    citadelConfig = await loadCitadelConfig(repoRoot);
  } catch (err) {
    if (err instanceof ConfigError) {
      return { ok: false, exitCode: 2, message: err.message };
    }
    return {
      ok: false,
      exitCode: 2,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  let tools: ReturnType<typeof listConnectorTools>;
  try {
    tools = listConnectorTools(citadelConfig);
  } catch (err) {
    return {
      ok: false,
      exitCode: 2,
      message:
        err instanceof Error
          ? `Failed to build connector tool surface: ${err.message}`
          : String(err),
    };
  }

  const server = new Server(
    { name: MCP_SERVER_NAME, version: serverVersion },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as { [k: string]: unknown },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const requestedName = request.params.name;
    const args = request.params.arguments ?? {};
    const match = findOperationByToolName(citadelConfig, requestedName);
    let envelope: Awaited<ReturnType<typeof invokeOperation>>;
    if (!match) {
      const failure: FailureInput = {
        connector: requestedName.split("__")[0] ?? requestedName,
        operation: requestedName.split("__").slice(1).join("__") || "(unknown)",
        code: "unknown-operation",
        message: `No tool named '${requestedName}' is registered. Run \`maester connector list\` to see configured tools.`,
      };
      envelope = buildFailureEnvelope(failure);
    } else {
      envelope = await invokeOperation({
        connector: match.connector,
        operationName: match.operationName,
        args,
      });
    }
    const text = JSON.stringify(envelope);
    if (envelope.ok) {
      return {
        content: [{ type: "text", text }],
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { ok: true, toolCount: tools.length, server };
}
