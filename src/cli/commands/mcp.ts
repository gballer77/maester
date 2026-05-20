import type { Command } from "commander";
import { bootMcpServer } from "../../core/mcp/server.js";
import { PACKAGE_VERSION } from "../../package-meta.js";
import type { CliContext } from "../context.js";

export function registerMcp(program: Command, getContext: () => CliContext): void {
  program
    .command("mcp")
    .description(
      "Run the stdio MCP server for this citadel. Intended to be spawned by an agent host (Claude Code, Cursor, Codex CLI) via project-level MCP config.",
    )
    .action(async () => {
      process.exitCode = await runMcpCommand(getContext());
    });
}

async function runMcpCommand(ctx: CliContext): Promise<number> {
  // The MCP server owns stdout for JSON-RPC frames — diagnostics go to stderr.
  // The boot helper calls `setupStdioForMcp()` itself, so console-style writes
  // inside the SDK are redirected before the server is constructed.
  const result = await bootMcpServer(ctx.repoRoot.path, PACKAGE_VERSION);
  if (!result.ok) {
    process.stderr.write(`maester mcp: ${result.message}\n`);
    return result.exitCode;
  }
  // The transport keeps the process alive until the host closes stdin.
  return 0;
}
