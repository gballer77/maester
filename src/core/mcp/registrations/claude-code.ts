import { promises as fs } from "node:fs";
import path from "node:path";

const MCP_FILE = ".mcp.json";

export const MAESTER_MCP_ENTRY = {
  command: "npx",
  args: ["maester", "mcp"],
} as const;

export type WriteOutcome = { filePath: string; action: "written" | "unchanged" };

/**
 * Write or refresh the `mcpServers.maester` entry inside `<repo>/.mcp.json`.
 * Round-trips every other top-level key and every other entry under
 * `mcpServers`. Idempotent — running twice produces byte-identical output.
 */
export async function writeClaudeCodeMcpEntry(repoRoot: string): Promise<WriteOutcome> {
  return writeJsonMcpFile(path.join(repoRoot, MCP_FILE));
}

export async function writeJsonMcpFile(filePath: string): Promise<WriteOutcome> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existingText = await readOrUndefined(filePath);
  const newText = renderJsonWithMaesterEntry(existingText);
  if (existingText === newText) {
    return { filePath, action: "unchanged" };
  }
  await fs.writeFile(filePath, newText, "utf8");
  return { filePath, action: "written" };
}

export function renderJsonWithMaesterEntry(existingText: string | undefined): string {
  const parsed = parseOrEmpty(existingText);
  const rebuilt: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "mcpServers") {
      rebuilt[key] = mutateMcpServers(value);
      placed = true;
    } else {
      rebuilt[key] = value;
    }
  }
  if (!placed) {
    rebuilt.mcpServers = mutateMcpServers(undefined);
  }
  return `${JSON.stringify(rebuilt, null, 2)}\n`;
}

function mutateMcpServers(existing: unknown): Record<string, unknown> {
  const map = isPlainObject(existing) ? { ...existing } : {};
  const rebuilt: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(map)) {
    if (key === "maester") {
      rebuilt[key] = { ...MAESTER_MCP_ENTRY };
      placed = true;
    } else {
      rebuilt[key] = value;
    }
  }
  if (!placed) {
    rebuilt.maester = { ...MAESTER_MCP_ENTRY };
  }
  return rebuilt;
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
