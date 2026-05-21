import CITADEL_AWARENESS from "../content/citadel-awareness.md";
import CONNECTOR_POLICY from "../content/connector-policy.md";
import FRESHNESS_AWARENESS from "../content/freshness-awareness.md";
import STATE_AWARENESS from "../content/state-awareness.md";

const DESCRIPTION =
  "Citadel-aware guidance for reading aggregated documentation under the citadel base directory.";

export function renderCursorRuleBody(opts: {
  baseDir: string;
  requiredEnvVars?: readonly string[];
}): string {
  const sections = [
    "# Grand Maester (Cursor rule)",
    "",
    "This rule applies when the user asks about content under the citadel",
    `base directory (\`${opts.baseDir}/\`).`,
    "",
    interpolate(CITADEL_AWARENESS, opts),
    "",
    interpolate(STATE_AWARENESS, opts),
    "",
    interpolate(FRESHNESS_AWARENESS, opts),
    "",
    interpolate(CONNECTOR_POLICY, opts),
  ];
  if (opts.requiredEnvVars && opts.requiredEnvVars.length > 0) {
    sections.push("", renderRequiredEnvVarsNote(opts.requiredEnvVars));
  }
  return sections.join("\n");
}

/**
 * Cursor's `.cursor/mcp.json` does not natively expand `${VAR}` placeholders
 * in its `env` block, so the maester MCP writer cannot seed connector env-var
 * names there (the way it does for Codex's `env_vars` and Claude Code's
 * `env`). Cursor's MCP subprocess instead inherits env from the shell that
 * launched Cursor — so the user must export the required vars in that shell.
 * This note in the Grand Maester artifact makes the required set visible.
 */
function renderRequiredEnvVarsNote(envVars: readonly string[]): string {
  const sorted = [...envVars].sort();
  const list = sorted.map((v) => `\`${v}\``).join(", ");
  return [
    "## Required environment variables (Cursor)",
    "",
    `This citadel exposes connectors that require these env vars: ${list}.`,
    "",
    "Cursor inherits env vars from the shell that launches it, so export them in",
    "that shell (e.g. in your `~/.zshrc` / `~/.bashrc` or by launching Cursor",
    "from a terminal where they are already set). The maester MCP server reads",
    "each value at tool-invocation time; if a var is unset, the call returns a",
    "`missing-env-var` envelope naming the variable.",
  ].join("\n");
}

export function renderCursorRuleFile(body: string, opts: { baseDir: string }): string {
  return [
    "---",
    `description: ${DESCRIPTION}`,
    `globs: ["${opts.baseDir}/**/*"]`,
    "alwaysApply: false",
    "---",
    "",
    body,
  ].join("\n");
}

function interpolate(template: string, opts: { baseDir: string }): string {
  return template.replace(/\{\{baseDir\}\}/g, opts.baseDir);
}
