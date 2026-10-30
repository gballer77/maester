import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { PACKAGE_VERSION } from "../../../package-meta.js";
import type { McpServer } from "../../../schemas/citadel.js";
import { mcpServerEnvVarNames } from "../registrations/env-vars.js";
import { type UpstreamFailure, classifyUpstreamError } from "./reasons.js";

export const UPSTREAM_STARTUP_TIMEOUT_MS = 10_000;

export type Env = Readonly<Record<string, string | undefined>>;

/** A connected upstream. `failure` becomes set when it exits mid-session. */
export type UpstreamHandle = {
  server: McpServer;
  tools: Tool[];
  /** Child pid for local servers (synchronous exit fallback). */
  pid: number | null;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
  readonly failure: UpstreamFailure | undefined;
  /** Called once when the upstream exits or its transport closes after startup. */
  onExit?: (failure: UpstreamFailure) => void;
};

export type ConnectResult =
  | { ok: true; handle: UpstreamHandle }
  | { ok: false; failure: UpstreamFailure };

export type ConnectOptions = {
  timeoutMs?: number;
  /** Sink for prefixed child stderr lines. Defaults to process.stderr. */
  log?: (line: string) => void;
};

/**
 * Start or connect to one upstream MCP server, initialize it and list its
 * tools within a bounded timeout (architecture §6.17, Gap 60). Never throws.
 */
export async function connectUpstream(
  server: McpServer,
  env: Env,
  options: ConnectOptions = {},
): Promise<ConnectResult> {
  const missing = mcpServerEnvVarNames(server).filter((name) => !env[name]);
  if (missing.length > 0) {
    return { ok: false, failure: { reason: "missing-env-var", detail: missing.join(", ") } };
  }
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const transport = createTransport(server, env, log);
  const client = new Client({ name: "maester-proxy", version: PACKAGE_VERSION });

  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("timeout"));
    }, options.timeoutMs ?? UPSTREAM_STARTUP_TIMEOUT_MS);
    timer.unref();
  });

  let tools: Tool[];
  try {
    tools = await Promise.race([
      (async () => {
        // SDK typing quirk under exactOptionalPropertyTypes (`sessionId?: string`).
        await client.connect(transport as Parameters<Client["connect"]>[0]);
        return listAllTools(client);
      })(),
      timeout,
    ]);
  } catch (err) {
    await client.close().catch(() => undefined);
    return { ok: false, failure: classifyUpstreamError(err, timedOut) };
  } finally {
    clearTimeout(timer);
  }

  let failure: UpstreamFailure | undefined;
  let closing = false;
  const handle: UpstreamHandle = {
    server,
    tools,
    pid: transport instanceof StdioClientTransport ? transport.pid : null,
    get failure() {
      return failure;
    },
    async callTool(name, args) {
      return (await client.callTool({ name, arguments: args })) as CallToolResult;
    },
    async close() {
      closing = true;
      await client.close().catch(() => undefined);
    },
  };
  client.onclose = () => {
    if (closing || failure) return;
    failure = { reason: "exited" };
    handle.onExit?.(failure);
  };
  return { ok: true, handle };
}

function createTransport(
  server: McpServer,
  env: Env,
  log: (line: string) => void,
): StdioClientTransport | StreamableHTTPClientTransport {
  if (server.kind === "local") {
    const childEnv: Record<string, string> = { ...getDefaultEnvironment() };
    for (const name of server.envVars ?? []) {
      const value = env[name];
      if (value) childEnv[name] = value;
    }
    const transport = new StdioClientTransport({
      command: server.command,
      args: [...(server.args ?? [])],
      env: childEnv,
      stderr: "pipe",
    });
    pipeStderr(transport, server.name, log);
    return transport;
  }
  const headers: Record<string, string> = {};
  if (server.auth) {
    const value = env[server.auth.envVar] ?? "";
    const header = server.auth.header ?? "Authorization";
    headers[header] = header.toLowerCase() === "authorization" ? `Bearer ${value}` : value;
  }
  return new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } });
}

function pipeStderr(transport: StdioClientTransport, name: string, log: (line: string) => void) {
  const stream = transport.stderr;
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      log(`[mcp-server:${name}] ${buffer.slice(0, newline)}`);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) log(`[mcp-server:${name}] ${buffer}`);
    buffer = "";
  });
}

async function listAllTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}
