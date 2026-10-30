import type { McpServer } from "../../../schemas/citadel.js";

/** MCP hosts that can receive direct-mode server entries. */
export type DirectHost = "claude-code" | "cursor" | "codex";

/** A direct server not written to one host, and why. */
export type DirectSkip = { host: DirectHost; server: string; reason: string };

export type RenderedDirectEntries = {
  entries: [name: string, entry: Record<string, unknown>][];
  skipped: DirectSkip[];
};

type Renderer = (server: McpServer) => Record<string, unknown> | { skip: string };

/**
 * Per-host translation of a `register: direct` server (architecture §6.17,
 * Gap 62). This table is the one place to change when a host's config shape
 * moves. Env-var values are never written — only names or `${NAME}` references
 * the host expands itself.
 */
export const HOST_CAPABILITIES: Record<DirectHost, Renderer> = {
  "claude-code": (server) => {
    if (server.kind === "local") {
      const entry: Record<string, unknown> = {
        command: server.command,
        args: [...(server.args ?? [])],
      };
      if (server.envVars?.length) {
        entry.env = Object.fromEntries(server.envVars.map((name) => [name, `\${${name}:-}`]));
      }
      return entry;
    }
    const entry: Record<string, unknown> = { type: "http", url: server.url };
    if (server.auth) {
      const header = server.auth.header ?? "Authorization";
      const ref = `\${${server.auth.envVar}}`;
      entry.headers = { [header]: isAuthorization(header) ? `Bearer ${ref}` : ref };
    }
    return entry;
  },
  cursor: (server) => {
    if (server.kind === "local") {
      // Cursor's child inherits the env Cursor was launched with (§6.16).
      return { command: server.command, args: [...(server.args ?? [])] };
    }
    if (server.auth) {
      return {
        skip: "Cursor's mcp.json cannot read a header value from an env var; use register: proxy or configure it in Cursor",
      };
    }
    return { url: server.url };
  },
  codex: (server) => {
    if (server.kind === "local") {
      const entry: Record<string, unknown> = {
        command: server.command,
        args: [...(server.args ?? [])],
      };
      if (server.envVars?.length) entry.env_vars = [...server.envVars];
      return entry;
    }
    const entry: Record<string, unknown> = { url: server.url };
    if (server.auth) {
      const header = server.auth.header ?? "Authorization";
      if (isAuthorization(header)) entry.bearer_token_env_var = server.auth.envVar;
      else entry.env_http_headers = { [header]: server.auth.envVar };
    }
    return entry;
  },
};

export function renderDirectEntries(
  host: DirectHost,
  servers: readonly McpServer[],
): RenderedDirectEntries {
  const result: RenderedDirectEntries = { entries: [], skipped: [] };
  for (const server of servers) {
    const rendered = HOST_CAPABILITIES[host](server);
    if ("skip" in rendered && typeof rendered.skip === "string") {
      result.skipped.push({ host, server: server.name, reason: rendered.skip });
    } else {
      result.entries.push([server.name, rendered]);
    }
  }
  return result;
}

/**
 * Apply direct entries to a host's server map using the managed-server ledger:
 * drop entries this ledger owned that are no longer direct, write current ones,
 * and never overwrite an entry the user created. Returns the new map, the new
 * ledger, and names skipped because an unmanaged entry already holds them.
 */
export function applyDirectEntries<T>(
  existing: Record<string, T>,
  previousLedger: readonly string[],
  entries: readonly [string, T][],
  reservedKey: string,
): { servers: Record<string, T>; ledger: string[]; conflicts: string[] } {
  const owned = new Set(previousLedger);
  const wanted = new Map(entries);
  const servers: Record<string, T> = {};
  const ledger: string[] = [];
  const conflicts: string[] = [];
  for (const [key, value] of Object.entries(existing)) {
    if (key === reservedKey) {
      servers[key] = value;
      continue;
    }
    const next = wanted.get(key);
    if (next !== undefined) {
      if (owned.has(key)) {
        servers[key] = next;
        ledger.push(key);
      } else {
        servers[key] = value;
        conflicts.push(key);
      }
      wanted.delete(key);
    } else if (!owned.has(key)) {
      servers[key] = value;
    }
  }
  for (const [key, value] of wanted) {
    servers[key] = value;
    ledger.push(key);
  }
  return { servers, ledger: ledger.sort(), conflicts };
}

function isAuthorization(header: string): boolean {
  return header.toLowerCase() === "authorization";
}
