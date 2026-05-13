import CITADEL_AWARENESS from "../content/citadel-awareness.md";
import FRESHNESS_AWARENESS from "../content/freshness-awareness.md";
import STATE_AWARENESS from "../content/state-awareness.md";

const DESCRIPTION =
  "Citadel-aware guidance for reading aggregated documentation under the citadel base directory.";

export function renderCursorRuleBody(opts: { baseDir: string }): string {
  return [
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
