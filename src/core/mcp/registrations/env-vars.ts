import {
  type CitadelConfig,
  type Connector,
  ENV_VAR_RE,
  type McpServer,
  isDirectMcpServer,
} from "../../../schemas/citadel.js";
import { loadCitadelConfig } from "../../config/loader.js";

export type ConnectorEnvVars = {
  /** De-duped, lexicographically sorted, regex-validated env-var names. */
  managed: readonly string[];
  /** Names dropped because they failed `ENV_VAR_RE`; surfaced to stderr. */
  invalid: readonly { connector: string; envVar: string }[];
};

const EMPTY: ConnectorEnvVars = { managed: [], invalid: [] };

export type ForwardedEnvVars = ConnectorEnvVars & {
  /** Who needs each forwarded name: `connector:<name>` / `mcp-server:<name>`. */
  contributors: Readonly<Record<string, readonly string[]>>;
};

/**
 * Collect the set of env-var names that token-auth connectors expect at MCP-tool
 * invocation time. The result feeds each host's native pass-through mechanism
 * (Codex `env_vars`, Claude Code `${VAR:-}` env entries) so the spawned MCP
 * subprocess inherits the values from the user's shell.
 *
 * Schema-level validation already rejects malformed `envVar` names at config
 * load, but this helper re-checks defensively so a hand-edited or pre-schema
 * config still produces a clean managed set.
 */
export function collectConnectorEnvVars(
  connectors: readonly Connector[] | undefined,
): ConnectorEnvVars {
  if (!connectors || connectors.length === 0) return EMPTY;
  const seen = new Set<string>();
  const invalid: { connector: string; envVar: string }[] = [];
  for (const c of connectors) {
    if (!c.auth || c.auth.type !== "token") continue;
    const name = c.auth.envVar;
    if (!ENV_VAR_RE.test(name)) {
      invalid.push({ connector: c.name, envVar: name });
      continue;
    }
    seen.add(name);
  }
  return { managed: Array.from(seen).sort(), invalid };
}

/**
 * Env-var names the `maester mcp` process needs (architecture §6.16, Gap 63):
 * connector token auth plus every **proxied** MCP server's `envVars` /
 * `auth.envVar`. Direct servers run in the host, so their names go into their
 * own direct entries instead.
 */
export function collectForwardedEnvVars(
  config: Pick<CitadelConfig, "connectors" | "mcpServers">,
): ForwardedEnvVars {
  const connectorVars = collectConnectorEnvVars(config.connectors);
  const contributors = new Map<string, string[]>();
  const add = (name: string, who: string) => {
    const list = contributors.get(name) ?? [];
    if (!list.includes(who)) list.push(who);
    contributors.set(name, list);
  };
  for (const c of config.connectors ?? []) {
    if (c.auth?.type === "token" && ENV_VAR_RE.test(c.auth.envVar)) {
      add(c.auth.envVar, `connector:${c.name}`);
    }
  }
  for (const server of config.mcpServers ?? []) {
    if (isDirectMcpServer(server)) continue;
    for (const name of mcpServerEnvVarNames(server)) {
      if (ENV_VAR_RE.test(name)) add(name, `mcp-server:${server.name}`);
    }
  }
  const managed = Array.from(contributors.keys()).sort();
  return {
    managed,
    invalid: connectorVars.invalid,
    contributors: Object.fromEntries(managed.map((n) => [n, contributors.get(n) ?? []])),
  };
}

/** Every env-var name one MCP server reads at startup. */
export function mcpServerEnvVarNames(server: McpServer): string[] {
  if (server.kind === "local") return [...(server.envVars ?? [])];
  return server.auth ? [server.auth.envVar] : [];
}

/**
 * Best-effort citadel load for the MCP writers and skill targets. Returns an
 * empty set when `citadel.yaml` is missing — the writer still emits a maester
 * entry on a fresh repo. Parse/validation errors are caught and reported via
 * `invalid`-like channels (the caller logs); the writer continues so an
 * unrelated config issue does not block the MCP entry from being registered.
 */
export async function loadConnectorEnvVarsBestEffort(
  repoRoot: string,
): Promise<ConnectorEnvVars & { loadError?: string }> {
  try {
    const config = await loadCitadelConfig(repoRoot);
    return collectForwardedEnvVars(config);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === "ENOENT" || /No citadel\.yaml/.test(message)) return EMPTY;
    return { ...EMPTY, loadError: message };
  }
}

export type McpRegistrationInputs = ForwardedEnvVars & {
  /** `register: direct` servers, written as their own host entries (§6.17). */
  directServers: readonly McpServer[];
  loadError?: string;
};

/** Best-effort load of everything the per-host writers need from `citadel.yaml`. */
export async function loadMcpRegistrationInputs(repoRoot: string): Promise<McpRegistrationInputs> {
  try {
    const config = await loadCitadelConfig(repoRoot);
    return {
      ...collectForwardedEnvVars(config),
      directServers: (config.mcpServers ?? []).filter(isDirectMcpServer),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === "ENOENT" || /No citadel\.yaml/.test(message))
      return { ...EMPTY, contributors: {}, directServers: [] };
    return { ...EMPTY, contributors: {}, directServers: [], loadError: message };
  }
}
