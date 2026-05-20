import { listSkillTargets } from "../../skill/targets/index.js";
import type { SkillTarget, SkillTargetId } from "../../skill/types.js";
import { writeClaudeCodeMcpEntry } from "./claude-code.js";
import { writeCodexMcpEntry } from "./codex.js";
import { writeCursorMcpEntry } from "./cursor.js";

export type McpRegistrationAction = "written" | "unchanged" | "skipped" | "failed";

export type McpRegistrationOutcome = {
  host: SkillTargetId;
  filePath: string;
  action: McpRegistrationAction;
  error?: string;
};

export type RefreshOptions = {
  /**
   * Restrict the refresh to a subset of Grand Maester targets. Useful in tests
   * and during init when only some targets were selected. When omitted, every
   * installed MCP-capable target is refreshed.
   */
  scopeTo?: readonly SkillTargetId[];
};

/**
 * Iterates installed Grand Maester targets and writes/refreshes the per-host
 * MCP server registration for each MCP-capable host (Claude Code, Cursor,
 * Codex CLI). The Generic `AGENTS.md` target is not an MCP host and is
 * skipped. A target whose skill artifact does not exist on disk is skipped
 * with `action: "skipped"`.
 */
export async function refreshMcpRegistrations(
  repoRoot: string,
  options: RefreshOptions = {},
): Promise<McpRegistrationOutcome[]> {
  const targets = listSkillTargets().filter(
    (t) => isMcpHost(t.id) && (!options.scopeTo || options.scopeTo.includes(t.id)),
  );

  const outcomes: McpRegistrationOutcome[] = [];
  for (const target of targets) {
    const installedVersion = await target.readInstalledVersion(repoRoot);
    if (installedVersion === undefined && !options.scopeTo?.includes(target.id)) {
      // Skill not installed; skip silently. Init / install flows scope
      // explicitly so a fresh install still writes the MCP entry.
      continue;
    }
    const outcome = await runWriter(target, repoRoot);
    outcomes.push(outcome);
  }
  return outcomes;
}

function isMcpHost(id: SkillTargetId): boolean {
  return id === "claude-code" || id === "cursor" || id === "codex";
}

async function runWriter(target: SkillTarget, repoRoot: string): Promise<McpRegistrationOutcome> {
  try {
    switch (target.id) {
      case "claude-code": {
        const r = await writeClaudeCodeMcpEntry(repoRoot);
        return { host: "claude-code", filePath: r.filePath, action: r.action };
      }
      case "cursor": {
        const r = await writeCursorMcpEntry(repoRoot);
        return { host: "cursor", filePath: r.filePath, action: r.action };
      }
      case "codex": {
        const r = await writeCodexMcpEntry(repoRoot);
        return { host: "codex", filePath: r.filePath, action: r.action };
      }
      default:
        return {
          host: target.id,
          filePath: "",
          action: "skipped",
        };
    }
  } catch (err) {
    return {
      host: target.id,
      filePath: "",
      action: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
