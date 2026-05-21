import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import { type MaesterLaunchCommand, resolveMaesterLaunchCommand } from "./command.js";

const CONFIG_FILE = path.join(".codex", "config.toml");

function maesterBlock(repoRoot: string, launch: MaesterLaunchCommand): TOML.JsonMap {
  return { command: launch.command, args: [...launch.args], cwd: repoRoot };
}

export type WriteOutcome = { filePath: string; action: "written" | "unchanged" };

export type WriteOptions = {
  /**
   * Override the launch command embedded in the registration. Primarily a test
   * escape hatch — production callers should rely on the default
   * (`process.argv[1] mcp`).
   */
  launch?: MaesterLaunchCommand;
};

/**
 * Write or refresh `[mcp_servers.maester]` inside `<repo>/.codex/config.toml`.
 * Includes a `cwd = "<absolute-citadel-path>"` field because Codex spawns MCP
 * subprocesses with `cwd = /` regardless of which config supplied the entry —
 * without it the server boots in `/` and exits looking for `citadel.yaml`.
 *
 * The block's `command` field embeds the absolute path to the running
 * `maester` binary (`process.argv[1]`) rather than `npx maester`, because
 * `npx` resolves by npm package name and the package is `baller-maester`.
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
  const newText = renderTomlWithMaesterBlock(existingText, repoRoot, launch);
  if (existingText === newText) {
    return { filePath, action: "unchanged" };
  }
  await fs.writeFile(filePath, newText, "utf8");
  return { filePath, action: "written" };
}

export function renderTomlWithMaesterBlock(
  existingText: string | undefined,
  repoRoot: string,
  launch: MaesterLaunchCommand,
): string {
  const parsed: TOML.JsonMap =
    existingText && existingText.trim().length > 0
      ? TOML.parse(existingText)
      : ({} as TOML.JsonMap);
  const mcpServers: TOML.JsonMap = isJsonMap(parsed.mcp_servers) ? { ...parsed.mcp_servers } : {};
  mcpServers.maester = maesterBlock(repoRoot, launch);
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
