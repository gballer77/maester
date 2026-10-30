import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { type CitadelConfig, type McpServer, isDirectMcpServer } from "../../../schemas/citadel.js";
import { type UpstreamFailure, formatFailure } from "./reasons.js";
import { proxiedToolName } from "./tool-name.js";
import { type ConnectOptions, type Env, type UpstreamHandle, connectUpstream } from "./upstream.js";

export type ProxiedTool = Tool & { server: string; upstreamName: string };

export type ServerWarning =
  | { type: "allowlist-miss"; tool: string }
  | { type: "name-collision"; tool: string; exposedName: string };

export type ServerReport =
  | { server: string; ok: true; tools: ProxiedTool[]; warnings: ServerWarning[] }
  | { server: string; ok: false; failure: UpstreamFailure; warnings: ServerWarning[] };

export type ProxyPool = {
  /** Settles once every server has connected or failed. Never rejects. */
  ready: Promise<ServerReport[]>;
  listTools(): ProxiedTool[];
  /** `undefined` when `exposedName` is not a proxied tool. */
  callTool(exposedName: string, args: Record<string, unknown>): Promise<CallToolResult> | undefined;
  /** Close every upstream (SIGTERM, then SIGKILL after a grace period). */
  shutdown(): Promise<void>;
  /** Synchronous last resort for `process.on("exit")`. */
  killSync(): void;
};

export type PoolOptions = ConnectOptions & {
  /** Sink for maester's own diagnostic lines. Defaults to process.stderr. */
  log?: (line: string) => void;
};

/**
 * Start every **proxied** server concurrently in the background (architecture
 * §6.17, Gap 58). Direct servers are host-managed and never started here.
 */
export function startProxyPool(
  servers: readonly McpServer[],
  env: Env,
  options: PoolOptions = {},
): ProxyPool {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const handles = new Map<string, UpstreamHandle>();
  const routes = new Map<string, ProxiedTool>();
  const tools: ProxiedTool[] = [];

  const proxied = servers.filter((s) => !isDirectMcpServer(s));
  const ready = Promise.all(
    proxied.map(async (server): Promise<ServerReport> => {
      const result = await connectUpstream(server, env, { ...options, log });
      if (!result.ok) {
        log(`[mcp-server:${server.name}] failed: ${formatFailure(result.failure)}`);
        return { server: server.name, ok: false, failure: result.failure, warnings: [] };
      }
      const { handle } = result;
      handles.set(server.name, handle);
      handle.onExit = (failure) =>
        log(`[mcp-server:${server.name}] ${formatFailure(failure)} — its tools are unavailable`);
      const exposed = exposeTools(server, handle.tools);
      for (const warning of exposed.warnings)
        log(`[mcp-server:${server.name}] ${describeWarning(warning)}`);
      return { server: server.name, ok: true, tools: exposed.tools, warnings: exposed.warnings };
    }),
  ).then((reports) => {
    // Register in declaration order so tools/list is deterministic.
    for (const report of reports) {
      if (!report.ok) continue;
      for (const tool of report.tools) {
        routes.set(tool.name, tool);
        tools.push(tool);
      }
    }
    return reports;
  });

  return {
    ready,
    listTools: () => [...tools],
    callTool(exposedName, args) {
      const route = routes.get(exposedName);
      if (!route) return undefined;
      const handle = handles.get(route.server);
      if (!handle || handle.failure) {
        return Promise.resolve(unavailable(route.server, handle?.failure?.reason ?? "exited"));
      }
      return handle.callTool(route.upstreamName, args).catch((err: unknown) => {
        if (handle.failure) return unavailable(route.server, handle.failure.reason);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `MCP server '${route.server}' failed to run '${route.upstreamName}': ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      });
    },
    async shutdown() {
      await ready;
      await Promise.all([...handles.values()].map((h) => h.close()));
    },
    killSync() {
      for (const handle of handles.values()) {
        if (handle.pid === null) continue;
        try {
          process.kill(handle.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    },
  };
}

/** Allowlist (P2) + `<server>__<tool>` naming with first-wins collisions (Gap 59). */
export function exposeTools(
  server: McpServer,
  upstreamTools: readonly Tool[],
): { tools: ProxiedTool[]; warnings: ServerWarning[] } {
  const warnings: ServerWarning[] = [];
  const allow = server.tools ? new Set(server.tools) : undefined;
  if (allow) {
    const offered = new Set(upstreamTools.map((t) => t.name));
    for (const name of allow) {
      if (!offered.has(name)) warnings.push({ type: "allowlist-miss", tool: name });
    }
  }
  const seen = new Set<string>();
  const tools: ProxiedTool[] = [];
  for (const tool of upstreamTools) {
    if (allow && !allow.has(tool.name)) continue;
    const exposedName = proxiedToolName(server.name, tool.name);
    if (seen.has(exposedName)) {
      warnings.push({ type: "name-collision", tool: tool.name, exposedName });
      continue;
    }
    seen.add(exposedName);
    tools.push({ ...tool, name: exposedName, server: server.name, upstreamName: tool.name });
  }
  return { tools, warnings };
}

export function describeWarning(warning: ServerWarning): string {
  return warning.type === "allowlist-miss"
    ? `allowlist-miss: the server does not offer '${warning.tool}'`
    : `name-collision: '${warning.tool}' also normalizes to '${warning.exposedName}' — dropped`;
}

function unavailable(server: string, reason: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `MCP server '${server}' is unavailable: ${reason}. Run \`maester mcp-server check\`, then restart your agent session.`,
      },
    ],
  };
}

export type CheckReport = {
  servers: (ServerReport | { server: string; direct: true })[];
  /** Proxied tools that would be exposed; connector tools are added by the caller. */
  proxiedToolCount: number;
};

/**
 * `maester mcp-server check`: the same connect path the proxy uses, outside an
 * agent session. Every client is closed before returning.
 */
export async function checkMcpServers(
  config: Pick<CitadelConfig, "mcpServers">,
  env: Env,
  options: PoolOptions & { names?: readonly string[] } = {},
): Promise<CheckReport> {
  const selected = (config.mcpServers ?? []).filter(
    (s) => !options.names || options.names.length === 0 || options.names.includes(s.name),
  );
  const pool = startProxyPool(selected, env, { ...options, log: options.log ?? (() => undefined) });
  const reports = await pool.ready;
  await pool.shutdown();
  const byName = new Map(reports.map((r) => [r.server, r]));
  const servers = selected.map(
    (s) => byName.get(s.name) ?? { server: s.name, direct: true as const },
  );
  const proxiedToolCount = reports.reduce((n, r) => n + (r.ok ? r.tools.length : 0), 0);
  return { servers, proxiedToolCount };
}
