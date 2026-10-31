import type { SkillKind, SkillTarget, SkillTargetId } from "../types.js";
import { claudeCodeTarget } from "./claude-code.js";
import { codexTarget } from "./codex.js";
import { cursorTarget } from "./cursor.js";
import { genericTarget } from "./generic.js";
import { PUBLISHER_TARGETS } from "./publisher.js";

const REGISTRY: readonly SkillTarget[] = [
  claudeCodeTarget,
  codexTarget,
  cursorTarget,
  genericTarget,
];

const REGISTRIES: Record<SkillKind, readonly SkillTarget[]> = {
  "grand-maester": REGISTRY,
  publisher: PUBLISHER_TARGETS,
};

/**
 * Targets for one skill kind. Defaults to the Grand Maester, so callers that
 * predate skill kinds — notably the MCP registration refresh — are unchanged.
 */
export function listSkillTargets(kind: SkillKind = "grand-maester"): readonly SkillTarget[] {
  return REGISTRIES[kind];
}

export function getTarget(id: SkillTargetId, kind: SkillKind = "grand-maester"): SkillTarget {
  const registry = REGISTRIES[kind];
  const found = registry.find((t) => t.id === id);
  if (!found) {
    throw new Error(
      `Unknown skill target '${id}'. Supported: ${registry.map((t) => t.id).join(", ")}`,
    );
  }
  return found;
}

/**
 * Group a selection of targets by their writer so multiple ids that share an
 * output trigger a single write call. The returned tuples preserve every id
 * label for reporting.
 */
export type DedupedTargetGroup = {
  writerKey: string;
  primary: SkillTarget;
  ids: SkillTargetId[];
  labels: string[];
  artifactPaths: readonly string[];
};

export function dedupeTargets(targets: readonly SkillTarget[]): DedupedTargetGroup[] {
  const groups = new Map<string, DedupedTargetGroup>();
  for (const target of targets) {
    const existing = groups.get(target.writerKey);
    if (existing) {
      existing.ids.push(target.id);
      existing.labels.push(target.label);
    } else {
      groups.set(target.writerKey, {
        writerKey: target.writerKey,
        primary: target,
        ids: [target.id],
        labels: [target.label],
        artifactPaths: target.artifactPaths,
      });
    }
  }
  return [...groups.values()];
}
