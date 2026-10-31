import PUBLISHER_VOCABULARY from "../content/publisher-vocabulary.md";
import PUBLISHER_WORKFLOW from "../content/publisher-workflow.md";

/**
 * The Publisher skill (architecture §6.19): one body for every target,
 * wrapped in each target's file shape. The body is the managed region.
 */
const DESCRIPTION =
  "Helps define what this repository publishes as a maester: proposes maester.yaml entries (paths, descriptions, categories, tags, state) from the repository's documentation, validates them with maester, and writes only what the user approves. Use when asked to set up, review or tidy maester.yaml or decide what this repo should share.";

export function renderPublisherBody(): string {
  return [
    "# Maester Publisher",
    "",
    "Guidance for proposing and maintaining this repository's `maester.yaml`.",
    "",
    PUBLISHER_WORKFLOW.trimEnd(),
    "",
    PUBLISHER_VOCABULARY.trimEnd(),
  ].join("\n");
}

/** Claude Code and Codex CLI share the SKILL.md shape. */
export function renderPublisherSkillFile(region: string): string {
  return ["---", "name: maester-publisher", `description: ${DESCRIPTION}`, "---", "", region].join(
    "\n",
  );
}

export function renderPublisherCursorRule(region: string): string {
  return [
    "---",
    `description: ${DESCRIPTION}`,
    'globs: ["maester.yaml"]',
    "alwaysApply: false",
    "---",
    "",
    region,
  ].join("\n");
}
