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
import {
  LIST_LINKED_DOCUMENTS_TOOL,
  type LinkedDestination,
  READ_LINKED_DOCUMENT_TOOL,
  findLinkedDestinations,
  linkedDocumentToolDescriptors,
  listLinkedDocuments,
  readLinkedDocument,
} from "./linked-docs.js";
import { type Env, type ProxyPool, startProxyPool } from "./proxy/index.js";
import { setupStdioForMcp } from "./transport.js";

export const MCP_SERVER_NAME = "maester";

export type McpBootResult =
  | { ok: true; toolCount: number; server: Server; pool: ProxyPool }
  | { ok: false; exitCode: number; message: string };

export type CreateMcpServerOptions = {
  /** Environment for proxied upstreams. Defaults to `process.env`. */
  env?: Env;
  /** Sink for proxy diagnostics. Defaults to stderr. */
  log?: (line: string) => void;
  /** Per-upstream startup timeout override (tests). */
  upstreamTimeoutMs?: number;
};

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
  const created = await createMcpServer(repoRoot, serverVersion);
  if (!created.ok) return created;
  installShutdown(created.pool);
  const transport = new StdioServerTransport();
  await created.server.connect(transport);
  return created;
}

/**
 * Proxied local servers must not outlive `maester mcp` (Gap 61): close them on
 * stdin end / SIGINT / SIGTERM, and SIGKILL any survivor synchronously on exit.
 */
function installShutdown(pool: ProxyPool): void {
  let stopping = false;
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    void pool.shutdown().finally(() => process.exit(code));
  };
  process.stdin.on("end", () => stop(0));
  process.stdin.on("close", () => stop(0));
  process.on("SIGINT", () => stop(130));
  process.on("SIGTERM", () => stop(143));
  process.on("exit", () => pool.killSync());
}

/**
 * Build the MCP server (connector tools, proxied tools, linked-doc tools)
 * without connecting a transport. The proxy pool starts in the background;
 * `tools/list` awaits its `ready` promise (Gap 58).
 */
export async function createMcpServer(
  repoRoot: string,
  serverVersion: string,
  options: CreateMcpServerOptions = {},
): Promise<McpBootResult> {
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

  let connectorTools: { name: string; description: string; inputSchema: unknown }[];
  let linkedTools: typeof connectorTools;
  // The linked-document tools are registered only when a link-mode
  // destination exists at boot (architecture §6.14).
  let linked: LinkedDestination[];
  try {
    linked = await findLinkedDestinations(citadelConfig, repoRoot);
    connectorTools = listConnectorTools(citadelConfig);
    linkedTools = linked.length > 0 ? linkedDocumentToolDescriptors() : [];
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

  const pool = startProxyPool(citadelConfig.mcpServers ?? [], options.env ?? process.env, {
    ...(options.log ? { log: options.log } : {}),
    ...(options.upstreamTimeoutMs ? { timeoutMs: options.upstreamTimeoutMs } : {}),
  });

  const server = new Server(
    { name: MCP_SERVER_NAME, version: serverVersion },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await pool.ready;
    const own = (t: (typeof connectorTools)[number]) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as { [k: string]: unknown },
    });
    // Order: connector tools, proxied tools, linked-doc tools (§4).
    const proxied = pool.listTools().map(({ server: _s, upstreamName: _u, ...tool }) => tool);
    return { tools: [...connectorTools.map(own), ...proxied, ...linkedTools.map(own)] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const requestedName = request.params.name;
    const args = request.params.arguments ?? {};
    if (linked.length > 0 && requestedName === LIST_LINKED_DOCUMENTS_TOOL) {
      const source = typeof args.source === "string" ? args.source : undefined;
      const listing = await listLinkedDocuments(linked, repoRoot, source);
      return { content: [{ type: "text", text: JSON.stringify(listing) }] };
    }
    if (linked.length > 0 && requestedName === READ_LINKED_DOCUMENT_TOOL) {
      const result =
        typeof args.path === "string"
          ? await readLinkedDocument(linked, repoRoot, args.path)
          : { ok: false as const, message: "`path` is required" };
      return result.ok
        ? { content: [{ type: "text", text: result.text }] }
        : { isError: true, content: [{ type: "text", text: result.message }] };
    }
    await pool.ready;
    const proxiedCall = pool.callTool(requestedName, args);
    if (proxiedCall) return proxiedCall;
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

  return { ok: true, toolCount: connectorTools.length + linkedTools.length, server, pool };
}
