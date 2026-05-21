import path from "node:path";
import { type WriteOptions, type WriteOutcome, writeJsonMcpFile } from "./claude-code.js";
import { resolveMaesterLaunchCommand } from "./command.js";

const MCP_FILE = path.join(".cursor", "mcp.json");

/**
 * Cursor adopted Anthropic's project-level MCP shape — same JSON structure
 * as `.mcp.json`, just nested under `.cursor/`. Unlike Claude Code, Cursor's
 * `mcp.json` does not natively expand `${VAR}` placeholders, so the framework
 * never injects connector env-var names into Cursor's `env` block. Cursor's
 * MCP subprocess instead inherits env from the shell that launched Cursor.
 * The required env-var names are surfaced to the user via the Cursor Grand
 * Maester artifact's note (see `src/core/skill/templates/shells/cursor.ts`).
 *
 * User-added `env` entries in `.cursor/mcp.json` are preserved verbatim — the
 * shared JSON writer's union-merge semantics treat the empty managed set as a
 * no-op on the env object.
 */
export async function writeCursorMcpEntry(
  repoRoot: string,
  options: WriteOptions = {},
): Promise<WriteOutcome> {
  const launch = options.launch ?? resolveMaesterLaunchCommand();
  return writeJsonMcpFile(path.join(repoRoot, MCP_FILE), launch, []);
}
