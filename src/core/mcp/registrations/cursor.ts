import path from "node:path";
import { type WriteOutcome, writeJsonMcpFile } from "./claude-code.js";

const MCP_FILE = path.join(".cursor", "mcp.json");

/**
 * Cursor adopted Anthropic's project-level MCP shape — same JSON structure
 * as `.mcp.json`, just nested under `.cursor/`.
 */
export async function writeCursorMcpEntry(repoRoot: string): Promise<WriteOutcome> {
  return writeJsonMcpFile(path.join(repoRoot, MCP_FILE));
}
