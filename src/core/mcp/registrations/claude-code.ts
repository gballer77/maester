import { promises as fs } from "node:fs";
import path from "node:path";
import { type MaesterLaunchCommand, resolveMaesterLaunchCommand } from "./command.js";

const MCP_FILE = ".mcp.json";

export type WriteOutcome = { filePath: string; action: "written" | "unchanged" };

export type WriteOptions = {
  /**
   * Override the launch command embedded in the registration. Primarily a test
   * escape hatch — production callers should rely on the default.
   */
  launch?: MaesterLaunchCommand;
  /**
   * Env-var names derived from `citadel.connectors[*].auth.envVar`. The writer
   * emits each as `"${VAR:-}"` inside `mcpServers.maester.env`. Claude Code
   * expands the placeholder against the user's shell env at server-spawn time
   * — the `:-` empty-default form keeps Claude Code's `.mcp.json` parser from
   * hard-failing when the var is unset; the missing-env-var failure is then
   * surfaced via the framework's usual error envelope at tool-invocation time.
   *
   * When the writer is used for a host that does NOT support `${VAR}`
   * expansion (i.e. Cursor's reuse of this JSON writer), pass an empty array
   * and the existing `env` object is left intact apart from user-added entries.
   */
  connectorEnvVars?: readonly string[];
};

/**
 * Marker key persisted inside `mcpServers.maester` so the next refresh can
 * distinguish framework-managed env keys (which should be stripped when no
 * connector still references them) from user-added env keys (which must be
 * preserved verbatim). camelCase to match JSON idiom; underscore-prefixed and
 * scoped to the maester entry so it's clearly "framework internal — do not
 * edit by hand."
 */
const MANAGED_MARKER_KEY = "_maesterManagedEnv";

function maesterEntry(
  launch: MaesterLaunchCommand,
  envObject: Record<string, string>,
  managed: readonly string[],
): Record<string, unknown> {
  const entry: Record<string, unknown> = { command: launch.command, args: [...launch.args] };
  if (Object.keys(envObject).length > 0) entry.env = envObject;
  if (managed.length > 0) entry[MANAGED_MARKER_KEY] = [...managed];
  return entry;
}

/**
 * Write or refresh the `mcpServers.maester` entry inside `<repo>/.mcp.json`.
 * Round-trips every other top-level key and every other entry under
 * `mcpServers`. Idempotent — running twice produces byte-identical output.
 *
 * The `command`/`args` come from `resolveMaesterLaunchCommand()`, which
 * emits the standard MCP-ecosystem convention `npx -y baller-maester mcp`
 * — portable across machines and self-updating on `npm publish`.
 */
export async function writeClaudeCodeMcpEntry(
  repoRoot: string,
  options: WriteOptions = {},
): Promise<WriteOutcome> {
  const launch = options.launch ?? resolveMaesterLaunchCommand();
  return writeJsonMcpFile(path.join(repoRoot, MCP_FILE), launch, options.connectorEnvVars ?? []);
}

export async function writeJsonMcpFile(
  filePath: string,
  launch: MaesterLaunchCommand,
  connectorEnvVars: readonly string[] = [],
): Promise<WriteOutcome> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existingText = await readOrUndefined(filePath);
  const newText = renderJsonWithMaesterEntry(existingText, launch, connectorEnvVars);
  if (existingText === newText) {
    return { filePath, action: "unchanged" };
  }
  await fs.writeFile(filePath, newText, "utf8");
  return { filePath, action: "written" };
}

export function renderJsonWithMaesterEntry(
  existingText: string | undefined,
  launch: MaesterLaunchCommand,
  connectorEnvVars: readonly string[] = [],
): string {
  const parsed = parseOrEmpty(existingText);
  const rebuilt: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "mcpServers") {
      rebuilt[key] = mutateMcpServers(value, launch, connectorEnvVars);
      placed = true;
    } else {
      rebuilt[key] = value;
    }
  }
  if (!placed) {
    rebuilt.mcpServers = mutateMcpServers(undefined, launch, connectorEnvVars);
  }
  return `${JSON.stringify(rebuilt, null, 2)}\n`;
}

function mutateMcpServers(
  existing: unknown,
  launch: MaesterLaunchCommand,
  connectorEnvVars: readonly string[],
): Record<string, unknown> {
  const map = isPlainObject(existing) ? { ...existing } : {};
  const rebuilt: Record<string, unknown> = {};
  const managedSorted = [...connectorEnvVars].sort();
  let placed = false;
  for (const [key, value] of Object.entries(map)) {
    if (key === "maester") {
      const mergedEnv = mergeEnvObject(value, connectorEnvVars);
      rebuilt[key] = maesterEntry(launch, mergedEnv, managedSorted);
      placed = true;
    } else {
      rebuilt[key] = value;
    }
  }
  if (!placed) {
    const mergedEnv = mergeEnvObject(undefined, connectorEnvVars);
    rebuilt.maester = maesterEntry(launch, mergedEnv, managedSorted);
  }
  return rebuilt;
}

/**
 * Compute the merged `env` object for the maester entry.
 *
 * - Framework-managed keys (in the current `connectorEnvVars` set) are
 *   emitted as `"${VAR:-}"` placeholders.
 * - Keys the framework previously managed (per the prior refresh's
 *   `_maesterManagedEnv` marker) but that are no longer in the current set
 *   are stripped — the "strip on removal" PRD requirement.
 * - All other existing keys are user-added and preserved verbatim.
 *
 * The result is sorted alphabetically so output is byte-identical across
 * refreshes.
 */
function mergeEnvObject(
  existingMaesterEntry: unknown,
  connectorEnvVars: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  const managed = new Set(connectorEnvVars);
  const previouslyManaged = readStringArray(
    isPlainObject(existingMaesterEntry) ? existingMaesterEntry[MANAGED_MARKER_KEY] : undefined,
  );
  const previouslyManagedSet = new Set(previouslyManaged);
  const existingEnv = isPlainObject(existingMaesterEntry) ? existingMaesterEntry.env : undefined;
  if (isPlainObject(existingEnv)) {
    for (const [k, v] of Object.entries(existingEnv)) {
      if (managed.has(k)) continue; // framework owns this key; rewritten below
      if (previouslyManagedSet.has(k)) continue; // stale managed entry — strip
      if (typeof v === "string") result[k] = v;
    }
  }
  for (const name of managed) result[name] = `\${${name}:-}`;
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(result).sort()) {
    const v = result[k];
    if (v !== undefined) sorted[k] = v;
  }
  return sorted;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function parseOrEmpty(text: string | undefined): Record<string, unknown> {
  if (!text || text.trim().length === 0) return {};
  const parsed = JSON.parse(text);
  if (!isPlainObject(parsed)) {
    throw new Error("Expected MCP config to be a JSON object at the top level.");
  }
  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
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
