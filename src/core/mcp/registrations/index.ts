import { listSkillTargets } from "../../skill/targets/index.js";
import type { SkillTarget, SkillTargetId } from "../../skill/types.js";
import { writeClaudeCodeMcpEntry } from "./claude-code.js";
import { writeCodexMcpEntry } from "./codex.js";
import { writeCursorMcpEntry } from "./cursor.js";
import { type DirectHost, type DirectSkip, renderDirectEntries } from "./direct.js";
import { type McpRegistrationInputs, loadMcpRegistrationInputs } from "./env-vars.js";

export type { DirectSkip } from "./direct.js";

export type McpRegistrationAction = "written" | "unchanged" | "skipped" | "failed";

export type McpRegistrationOutcome = {
  host: SkillTargetId;
  filePath: string;
  action: McpRegistrationAction;
  error?: string;
  /** Direct servers not written to this host (unsupported kind, or an unmanaged entry holds the name). */
  skipped?: DirectSkip[];
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

  const inputs = await loadMcpRegistrationInputs(repoRoot);
  surfaceEnvVarDiagnostics(inputs);

  const outcomes: McpRegistrationOutcome[] = [];
  for (const target of targets) {
    const installedVersion = await target.readInstalledVersion(repoRoot);
    if (installedVersion === undefined && !options.scopeTo?.includes(target.id)) {
      // Skill not installed; skip silently. Init / install flows scope
      // explicitly so a fresh install still writes the MCP entry.
      continue;
    }
    const outcome = await runWriter(target, repoRoot, inputs);
    for (const skip of outcome.skipped ?? []) {
      process.stderr.write(
        `maester: warning: MCP server '${skip.server}' not registered with ${skip.host}: ${skip.reason}.\n`,
      );
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

function isMcpHost(id: SkillTargetId): id is DirectHost {
  return id === "claude-code" || id === "cursor" || id === "codex";
}

async function runWriter(
  target: SkillTarget,
  repoRoot: string,
  inputs: McpRegistrationInputs,
): Promise<McpRegistrationOutcome> {
  if (!isMcpHost(target.id)) {
    return { host: target.id, filePath: "", action: "skipped" };
  }
  const host: DirectHost = target.id;
  const { entries: directEntries, skipped } = renderDirectEntries(host, inputs.directServers);
  const connectorEnvVars = inputs.managed;
  try {
    const r =
      host === "claude-code"
        ? await writeClaudeCodeMcpEntry(repoRoot, { connectorEnvVars, directEntries })
        : host === "cursor"
          ? await writeCursorMcpEntry(repoRoot, { directEntries })
          : await writeCodexMcpEntry(repoRoot, { connectorEnvVars, directEntries });
    for (const server of r.conflicts ?? []) {
      skipped.push({
        host,
        server,
        reason: `an entry named '${server}' already exists and is not managed by maester; left untouched`,
      });
    }
    return {
      host,
      filePath: r.filePath,
      action: r.action,
      ...(skipped.length > 0 ? { skipped } : {}),
    };
  } catch (err) {
    return {
      host,
      filePath: "",
      action: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function surfaceEnvVarDiagnostics(envVars: McpRegistrationInputs): void {
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
