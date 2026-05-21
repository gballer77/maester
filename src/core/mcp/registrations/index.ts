import { listSkillTargets } from "../../skill/targets/index.js";
import type { SkillTarget, SkillTargetId } from "../../skill/types.js";
import { writeClaudeCodeMcpEntry } from "./claude-code.js";
import { writeCodexMcpEntry } from "./codex.js";
import { writeCursorMcpEntry } from "./cursor.js";
import { type ConnectorEnvVars, loadConnectorEnvVarsBestEffort } from "./env-vars.js";

export type McpRegistrationAction = "written" | "unchanged" | "skipped" | "failed";

export type McpRegistrationOutcome = {
  host: SkillTargetId;
  filePath: string;
  action: McpRegistrationAction;
  error?: string;
};

export type RefreshOptions = {
  /**
   * Restrict the refresh to a subset of Grand Maester targets. Useful in tests
   * and during init when only some targets were selected. When omitted, every
   * installed MCP-capable target is refreshed.
   */
  scopeTo?: readonly SkillTargetId[];
};

/**
 * Iterates installed Grand Maester targets and writes/refreshes the per-host
 * MCP server registration for each MCP-capable host (Claude Code, Cursor,
 * Codex CLI). The Generic `AGENTS.md` target is not an MCP host and is
 * skipped. A target whose skill artifact does not exist on disk is skipped
 * with `action: "skipped"`.
 *
 * Connector env-var names declared in `citadel.yaml` are seeded into each
 * host's native pass-through mechanism (Codex `env_vars`; Claude Code
 * `${VAR:-}` env entries). Cursor inherits env from its parent process and
 * surfaces the required names through its Grand Maester artifact instead.
 */
export async function refreshMcpRegistrations(
  repoRoot: string,
  options: RefreshOptions = {},
): Promise<McpRegistrationOutcome[]> {
  const targets = listSkillTargets().filter(
    (t) => isMcpHost(t.id) && (!options.scopeTo || options.scopeTo.includes(t.id)),
  );

  const envVars = await loadConnectorEnvVarsBestEffort(repoRoot);
  surfaceEnvVarDiagnostics(envVars);

  const outcomes: McpRegistrationOutcome[] = [];
  for (const target of targets) {
    const installedVersion = await target.readInstalledVersion(repoRoot);
    if (installedVersion === undefined && !options.scopeTo?.includes(target.id)) {
      // Skill not installed; skip silently. Init / install flows scope
      // explicitly so a fresh install still writes the MCP entry.
      continue;
    }
    const outcome = await runWriter(target, repoRoot, envVars.managed);
    outcomes.push(outcome);
  }
  return outcomes;
}

function isMcpHost(id: SkillTargetId): boolean {
  return id === "claude-code" || id === "cursor" || id === "codex";
}

async function runWriter(
  target: SkillTarget,
  repoRoot: string,
  connectorEnvVars: readonly string[],
): Promise<McpRegistrationOutcome> {
  try {
    switch (target.id) {
      case "claude-code": {
        const r = await writeClaudeCodeMcpEntry(repoRoot, { connectorEnvVars });
        return { host: "claude-code", filePath: r.filePath, action: r.action };
      }
      case "cursor": {
        const r = await writeCursorMcpEntry(repoRoot);
        return { host: "cursor", filePath: r.filePath, action: r.action };
      }
      case "codex": {
        const r = await writeCodexMcpEntry(repoRoot, { connectorEnvVars });
        return { host: "codex", filePath: r.filePath, action: r.action };
      }
      default:
        return {
          host: target.id,
          filePath: "",
          action: "skipped",
        };
    }
  } catch (err) {
    return {
      host: target.id,
      filePath: "",
      action: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function surfaceEnvVarDiagnostics(envVars: ConnectorEnvVars & { loadError?: string }): void {
  if (envVars.loadError !== undefined) {
    process.stderr.write(
      `maester: warning: citadel.yaml could not be loaded for MCP env-var seeding (${envVars.loadError}); writing entries without connector env vars.\n`,
    );
  }
  for (const entry of envVars.invalid) {
    process.stderr.write(
      `maester: warning: connector '${entry.connector}' declares env-var '${entry.envVar}' which is not a valid name (uppercase letters, digits, underscore, starting with a letter); skipping.\n`,
    );
  }
}
