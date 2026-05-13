import type { SkillTarget, SkillTargetId } from "../types.js";
import { claudeCodeTarget } from "./claude-code.js";
import { codexTarget } from "./codex.js";
import { cursorTarget } from "./cursor.js";
import { genericTarget } from "./generic.js";

const REGISTRY: readonly SkillTarget[] = [
  claudeCodeTarget,
  codexTarget,
  cursorTarget,
  genericTarget,
];

export function listSkillTargets(): readonly SkillTarget[] {
  return REGISTRY;
}

export function getTarget(id: SkillTargetId): SkillTarget {
  const found = REGISTRY.find((t) => t.id === id);
  if (!found) {
    throw new Error(
      `Unknown skill target '${id}'. Supported: ${REGISTRY.map((t) => t.id).join(", ")}`,
    );
  }
  return found;
}

/**
 * Group a selection of targets by their writer so multiple ids that share an
 * output (e.g. `codex` + `agents-md` both write `AGENTS.md`) trigger a single
 * write call. The returned tuples preserve every id label for reporting.
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
