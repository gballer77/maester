import CITADEL_AWARENESS from "../content/citadel-awareness.md";
import CONNECTOR_POLICY from "../content/connector-policy.md";
import FRESHNESS_AWARENESS from "../content/freshness-awareness.md";
import STATE_AWARENESS from "../content/state-awareness.md";

const SKILL_FRONTMATTER_DESCRIPTION =
  "Citadel-aware guidance for reading aggregated documentation under the citadel base directory. Prefers canon files over draft and runs maester status before substantial citadel reads.";

export function renderClaudeSkillBody(opts: { baseDir: string }): string {
  return [
    "# Grand Maester (Claude Code skill)",
    "",
    "Use this guidance whenever you read files under the citadel base directory",
    `(\`${opts.baseDir}/\`) in this repository.`,
    "",
    interpolate(CITADEL_AWARENESS, opts),
    "",
    interpolate(STATE_AWARENESS, opts),
    "",
    interpolate(FRESHNESS_AWARENESS, opts),
    "",
    interpolate(CONNECTOR_POLICY, opts),
  ].join("\n");
}

export function renderClaudeSkillFile(body: string): string {
  return [
    "---",
    "name: grand-maester",
    `description: ${SKILL_FRONTMATTER_DESCRIPTION}`,
    "---",
    "",
    body,
  ].join("\n");
}

export type ClaudeMaesterBlock = {
  version: string;
  hooks: {
    PreToolUse: Array<{
      matcher: string;
      hooks: Array<{ type: "command"; command: string }>;
    }>;
  };
};

export function buildClaudeMaesterBlock(version: string): ClaudeMaesterBlock {
  return {
    version,
    hooks: {
      PreToolUse: [
        {
          matcher: "Read|Glob|Grep",
          hooks: [{ type: "command", command: "npx -y baller-maester skill runtime preread" }],
        },
      ],
    },
  };
}

function interpolate(template: string, opts: { baseDir: string }): string {
  return template.replace(/\{\{baseDir\}\}/g, opts.baseDir);
}
