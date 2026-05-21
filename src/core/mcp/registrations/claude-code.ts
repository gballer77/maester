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
};

function maesterEntry(launch: MaesterLaunchCommand): Record<string, unknown> {
  return { command: launch.command, args: [...launch.args] };
}

/**
 * Write or refresh the `mcpServers.maester` entry inside `<repo>/.mcp.json`.
 * Round-trips every other top-level key and every other entry under
 * `mcpServers`. Idempotent — running twice produces byte-identical output.
 *
 * The `command` field embeds the absolute path to the running `maester`
 * binary (`process.argv[1]`) rather than `npx maester`, because `npx`
 * resolves by npm package name and our package is `baller-maester`.
 */
export async function writeClaudeCodeMcpEntry(
  repoRoot: string,
  options: WriteOptions = {},
): Promise<WriteOutcome> {
  const launch = options.launch ?? resolveMaesterLaunchCommand();
  return writeJsonMcpFile(path.join(repoRoot, MCP_FILE), launch);
}

export async function writeJsonMcpFile(
  filePath: string,
  launch: MaesterLaunchCommand,
): Promise<WriteOutcome> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existingText = await readOrUndefined(filePath);
  const newText = renderJsonWithMaesterEntry(existingText, launch);
  if (existingText === newText) {
    return { filePath, action: "unchanged" };
  }
  await fs.writeFile(filePath, newText, "utf8");
  return { filePath, action: "written" };
}

export function renderJsonWithMaesterEntry(
  existingText: string | undefined,
  launch: MaesterLaunchCommand,
): string {
  const parsed = parseOrEmpty(existingText);
  const rebuilt: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "mcpServers") {
      rebuilt[key] = mutateMcpServers(value, launch);
      placed = true;
    } else {
      rebuilt[key] = value;
    }
  }
  if (!placed) {
    rebuilt.mcpServers = mutateMcpServers(undefined, launch);
  }
  return `${JSON.stringify(rebuilt, null, 2)}\n`;
}

function mutateMcpServers(
  existing: unknown,
  launch: MaesterLaunchCommand,
): Record<string, unknown> {
  const map = isPlainObject(existing) ? { ...existing } : {};
  const rebuilt: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(map)) {
    if (key === "maester") {
      rebuilt[key] = maesterEntry(launch);
      placed = true;
    } else {
      rebuilt[key] = value;
    }
  }
  if (!placed) {
    rebuilt.maester = maesterEntry(launch);
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
