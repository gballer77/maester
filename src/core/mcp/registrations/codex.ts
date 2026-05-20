import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";

const CONFIG_FILE = path.join(".codex", "config.toml");

function maesterBlock(): TOML.JsonMap {
  return { command: "npx", args: ["maester", "mcp"] };
}

export type WriteOutcome = { filePath: string; action: "written" | "unchanged" };

/**
 * Write or refresh `[mcp_servers.maester]` inside `<repo>/.codex/config.toml`.
 * Other tables in the file are preserved (the TOML library doesn't preserve
 * comments — accepted tradeoff per architecture Gap 39). Idempotent.
 */
export async function writeCodexMcpEntry(repoRoot: string): Promise<WriteOutcome> {
  const filePath = path.join(repoRoot, CONFIG_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existingText = await readOrUndefined(filePath);
  const newText = renderTomlWithMaesterBlock(existingText);
  if (existingText === newText) {
    return { filePath, action: "unchanged" };
  }
  await fs.writeFile(filePath, newText, "utf8");
  return { filePath, action: "written" };
}

export function renderTomlWithMaesterBlock(existingText: string | undefined): string {
  const parsed: TOML.JsonMap =
    existingText && existingText.trim().length > 0
      ? TOML.parse(existingText)
      : ({} as TOML.JsonMap);
  const mcpServers: TOML.JsonMap = isJsonMap(parsed.mcp_servers) ? { ...parsed.mcp_servers } : {};
  mcpServers.maester = maesterBlock();
  const next: TOML.JsonMap = { ...parsed, mcp_servers: mcpServers };
  return TOML.stringify(next);
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
