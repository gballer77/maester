import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import { listSkillTargets } from "../../skill/targets/index.js";
import type { SkillTarget, SkillTargetId } from "../../skill/types.js";
import { renderJsonMcpConfig } from "./claude-code.js";
import { renderCodexConfig } from "./codex.js";
import { resolveMaesterLaunchCommand } from "./command.js";
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
  try {
    const r = await renderHost(host, repoRoot, inputs);
    const changed = r.existingText !== r.text;
    if (changed) {
      await fs.mkdir(path.dirname(r.filePath), { recursive: true });
      await fs.writeFile(r.filePath, r.text, "utf8");
    }
    return {
      host,
      filePath: r.filePath,
      action: changed ? "written" : "unchanged",
      ...(r.skipped.length > 0 ? { skipped: r.skipped } : {}),
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

const HOST_FILES: Record<DirectHost, string> = {
  "claude-code": ".mcp.json",
  cursor: path.join(".cursor", "mcp.json"),
  codex: path.join(".codex", "config.toml"),
};

type RenderedHost = {
  filePath: string;
  existingText: string | undefined;
  text: string;
  skipped: DirectSkip[];
};

/**
 * Render one host's registration file in memory from its current contents.
 * Shared by the real refresh and the dry-run plan so the two cannot disagree.
 */
async function renderHost(
  host: DirectHost,
  repoRoot: string,
  inputs: McpRegistrationInputs,
): Promise<RenderedHost> {
  const filePath = path.join(repoRoot, HOST_FILES[host]);
  const existingText = await readOrUndefined(filePath);
  const launch = resolveMaesterLaunchCommand();
  const { entries: directEntries, skipped } = renderDirectEntries(host, inputs.directServers);
  // Cursor does not expand `${VAR}`, so it never receives forwarded names (§6.16).
  const forwarded = host === "cursor" ? [] : inputs.managed;
  const { text, conflicts } =
    host === "codex"
      ? renderCodexConfig(existingText, launch, forwarded, directEntries)
      : renderJsonMcpConfig(existingText, launch, forwarded, directEntries);
  for (const server of conflicts) {
    skipped.push({
      host,
      server,
      reason: `an entry named '${server}' already exists and is not managed by maester; left untouched`,
    });
  }
  return { filePath, existingText, text, skipped };
}

export type McpRegistrationPlan = {
  host: DirectHost;
  filePath: string;
  /** A real refresh would rewrite the file. */
  wouldChange: boolean;
  /** Names maester forwards into this host's server env (empty for Cursor). */
  forwardedEnvVars: string[];
  /** Names added by hand to the maester entry's env; a refresh keeps them. */
  userEnvVars: string[];
  /** Direct servers maester would own in this file after a refresh. */
  directWritten: string[];
  /** Direct servers a refresh would remove (dropped from `citadel.yaml`). */
  directRemoved: string[];
  skipped: DirectSkip[];
  error?: string;
};

export type McpRegistrationPlanResult = {
  inputs: McpRegistrationInputs;
  hosts: McpRegistrationPlan[];
};

/**
 * The `connector refresh --dry-run` engine (§6.16, Gap 73): what a refresh
 * would write for each installed MCP host, computed in memory. Writes nothing.
 */
export async function planMcpRegistrations(
  repoRoot: string,
  options: RefreshOptions = {},
): Promise<McpRegistrationPlanResult> {
  const inputs = await loadMcpRegistrationInputs(repoRoot);
  const hosts: McpRegistrationPlan[] = [];
  for (const target of listSkillTargets()) {
    if (!isMcpHost(target.id)) continue;
    if (options.scopeTo && !options.scopeTo.includes(target.id)) continue;
    const installed = (await target.readInstalledVersion(repoRoot)) !== undefined;
    if (!installed && !options.scopeTo?.includes(target.id)) continue;
    const host: DirectHost = target.id;
    const filePath = path.join(repoRoot, HOST_FILES[host]);
    try {
      const r = await renderHost(host, repoRoot, inputs);
      const before = readMaesterEntry(host, r.existingText);
      const after = readMaesterEntry(host, r.text);
      const forwarded = new Set(after.managedEnv);
      hosts.push({
        host,
        filePath,
        wouldChange: r.existingText !== r.text,
        forwardedEnvVars: [...after.managedEnv],
        userEnvVars: after.env.filter((n) => !forwarded.has(n)),
        directWritten: [...after.managedServers],
        directRemoved: before.managedServers.filter((n) => !after.managedServers.includes(n)),
        skipped: r.skipped,
      });
    } catch (err) {
      hosts.push({
        host,
        filePath,
        wouldChange: false,
        forwardedEnvVars: [],
        userEnvVars: [],
        directWritten: [],
        directRemoved: [],
        skipped: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { inputs, hosts };
}

type MaesterEntryView = { env: string[]; managedEnv: string[]; managedServers: string[] };

/** The maester entry's env names and ledgers, as written in a host file. */
function readMaesterEntry(host: DirectHost, text: string | undefined): MaesterEntryView {
  const empty: MaesterEntryView = { env: [], managedEnv: [], managedServers: [] };
  if (!text || text.trim().length === 0) return empty;
  if (host === "codex") {
    const servers = (TOML.parse(text) as Record<string, unknown>).mcp_servers;
    const entry = isRecord(servers) ? servers.maester : undefined;
    if (!isRecord(entry)) return empty;
    return {
      env: strings(entry.env_vars),
      managedEnv: strings(entry._maester_managed_env_vars),
      managedServers: strings(entry._maester_managed_servers),
    };
  }
  const servers = (JSON.parse(text) as Record<string, unknown>).mcpServers;
  const entry = isRecord(servers) ? servers.maester : undefined;
  if (!isRecord(entry)) return empty;
  return {
    env: isRecord(entry.env) ? Object.keys(entry.env) : [],
    managedEnv: strings(entry._maesterManagedEnv),
    managedServers: strings(entry._maesterManagedServers),
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
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
