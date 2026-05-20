import CITADEL_AWARENESS from "../content/citadel-awareness.md";
import FRESHNESS_AWARENESS from "../content/freshness-awareness.md";
import STATE_AWARENESS from "../content/state-awareness.md";

const SKILL_FRONTMATTER_DESCRIPTION =
  "Citadel-aware guidance for reading aggregated documentation under the citadel base directory. Prefers canon files over draft and runs maester status before substantial citadel reads.";

export function renderCodexSkillBody(opts: { baseDir: string }): string {
  return [
    "# Grand Maester (Codex CLI skill)",
    "",
    "Use this guidance whenever you read files under the citadel base directory",
    `(\`${opts.baseDir}/\`) in this repository.`,
    "",
    interpolate(CITADEL_AWARENESS, opts),
    "",
    interpolate(STATE_AWARENESS, opts),
    "",
    interpolate(FRESHNESS_AWARENESS, opts),
  ].join("\n");
}

export function renderCodexSkillFile(body: string): string {
  return [
    "---",
    "name: grand-maester",
    `description: ${SKILL_FRONTMATTER_DESCRIPTION}`,
    "---",
    "",
    body,
  ].join("\n");
}

function interpolate(template: string, opts: { baseDir: string }): string {
  return template.replace(/\{\{baseDir\}\}/g, opts.baseDir);
}
