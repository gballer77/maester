import path from "node:path";
import { type WriteOptions, type WriteOutcome, writeJsonMcpFile } from "./claude-code.js";
import { resolveMaesterLaunchCommand } from "./command.js";

const MCP_FILE = path.join(".cursor", "mcp.json");

/**
 * Cursor adopted Anthropic's project-level MCP shape — same JSON structure
 * as `.mcp.json`, just nested under `.cursor/`.
 */
export async function writeCursorMcpEntry(
  repoRoot: string,
  options: WriteOptions = {},
): Promise<WriteOutcome> {
  const launch = options.launch ?? resolveMaesterLaunchCommand();
  return writeJsonMcpFile(path.join(repoRoot, MCP_FILE), launch);
}
