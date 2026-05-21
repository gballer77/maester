import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import { type MaesterLaunchCommand, resolveMaesterLaunchCommand } from "./command.js";

const CONFIG_FILE = path.join(".codex", "config.toml");

/**
 * Marker key persisted alongside `env_vars` so the next refresh can
 * distinguish framework-managed names (which should be removed when no
 * connector still references them) from user-added names (which must be
 * preserved verbatim across refreshes). The key is underscore-prefixed and
 * scoped to the maester block so it's clearly "framework internal — do not
 * edit by hand."
 */
const MANAGED_MARKER_KEY = "_maester_managed_env_vars";

function maesterBlock(
  launch: MaesterLaunchCommand,
  envVars: readonly string[],
  managed: readonly string[],
): TOML.JsonMap {
  const block: TOML.JsonMap = { command: launch.command, args: [...launch.args] };
  if (envVars.length > 0) block.env_vars = [...envVars];
  if (managed.length > 0) block[MANAGED_MARKER_KEY] = [...managed];
  return block;
}

export type WriteOutcome = { filePath: string; action: "written" | "unchanged" };

export type WriteOptions = {
  /**
   * Override the launch command embedded in the registration. Primarily a test
   * escape hatch — production callers should rely on the default
   * (`process.argv[1] mcp`).
   */
  launch?: MaesterLaunchCommand;
  /**
   * Env-var names derived from `citadel.connectors[*].auth.envVar`. The writer
   * unions these with whatever the user already added to `env_vars` and emits
   * the de-duplicated, stable-sorted result. Codex passes each named var
   * through from its own shell environment to the spawned MCP subprocess.
   */
  connectorEnvVars?: readonly string[];
};

/**
 * Write or refresh `[mcp_servers.maester]` inside `<repo>/.codex/config.toml`.
 *
 * The block's `command`/`args` come from `resolveMaesterLaunchCommand()`,
 * which emits the standard MCP-ecosystem convention
 * `npx -y baller-maester mcp` — portable across machines and self-updating
 * on `npm publish`. No absolute paths are embedded, so the file is safe to
 * commit.
 *
 * Codex CLI reads `<repo>/.codex/config.toml` for trusted projects and
 * merges it with the user-global `~/.codex/config.toml` (verified on Codex
 * v0.132). The user must have `[projects."<repo-root>"] trust_level =
 * "trusted"` in their global config for this file to load.
 *
 * Other tables in the file are preserved (the TOML library doesn't preserve
 * comments — accepted tradeoff per architecture Gap 39). Idempotent.
 */
export async function writeCodexMcpEntry(
  repoRoot: string,
  options: WriteOptions = {},
): Promise<WriteOutcome> {
  const filePath = path.join(repoRoot, CONFIG_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existingText = await readOrUndefined(filePath);
  const launch = options.launch ?? resolveMaesterLaunchCommand();
  const newText = renderTomlWithMaesterBlock(existingText, launch, options.connectorEnvVars ?? []);
  if (existingText === newText) {
    return { filePath, action: "unchanged" };
  }
  await fs.writeFile(filePath, newText, "utf8");
  return { filePath, action: "written" };
}

export function renderTomlWithMaesterBlock(
  existingText: string | undefined,
  launch: MaesterLaunchCommand,
  connectorEnvVars: readonly string[] = [],
): string {
  const parsed: TOML.JsonMap =
    existingText && existingText.trim().length > 0
      ? TOML.parse(existingText)
      : ({} as TOML.JsonMap);
  const mcpServers: TOML.JsonMap = isJsonMap(parsed.mcp_servers) ? { ...parsed.mcp_servers } : {};
  const existingMaester = isJsonMap(mcpServers.maester) ? mcpServers.maester : undefined;
  const previouslyManaged = readStringArray(existingMaester?.[MANAGED_MARKER_KEY]);
  const userAdded = userAddedEnvVars(existingMaester?.env_vars, previouslyManaged);
  const mergedEnvVars = Array.from(new Set([...connectorEnvVars, ...userAdded])).sort();
  mcpServers.maester = maesterBlock(launch, mergedEnvVars, [...connectorEnvVars].sort());
  const next: TOML.JsonMap = { ...parsed, mcp_servers: mcpServers };
  return TOML.stringify(next);
}

/**
 * Existing entries minus the framework's previously-managed set = user-added.
 * Anything the framework previously emitted that is no longer in the current
 * connector-derived set is dropped from the merged list (the "strip on
 * removal" PRD requirement). Anything that was user-added is preserved
 * verbatim.
 */
function userAddedEnvVars(existing: unknown, previouslyManaged: readonly string[]): string[] {
  if (!Array.isArray(existing)) return [];
  const managedSet = new Set(previouslyManaged);
  const result: string[] = [];
  for (const entry of existing) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (managedSet.has(entry)) continue;
    result.push(entry);
  }
  return result;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function isJsonMap(value: unknown): value is TOML.JsonMap {
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
