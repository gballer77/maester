import { type Connector, ENV_VAR_RE } from "../../../schemas/citadel.js";
import { loadCitadelConfig } from "../../config/loader.js";

export type ConnectorEnvVars = {
  /** De-duped, lexicographically sorted, regex-validated env-var names. */
  managed: readonly string[];
  /** Names dropped because they failed `ENV_VAR_RE`; surfaced to stderr. */
  invalid: readonly { connector: string; envVar: string }[];
};

const EMPTY: ConnectorEnvVars = { managed: [], invalid: [] };

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
    return collectConnectorEnvVars(config.connectors);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === "ENOENT" || /No citadel\.yaml/.test(message)) return EMPTY;
    return { ...EMPTY, loadError: message };
  }
}
