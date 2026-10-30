import type { PathSource } from "../../schemas/citadel.js";
import { MaesterError } from "../errors.js";
import { type OverlapTargets, expandSourcePath } from "../sources/local-path.js";
import { fetchLocalSource } from "../sources/local-source.js";
import { findDanglingLinks } from "../sync/link.js";
import { type ProvenanceMarker, readProvenanceMarker } from "../sync/provenance.js";
import type { BehindReason, StatusOutcome, StatusOutcomeBase } from "./runner.js";

const DANGLING_LIST_LIMIT = 5;

export type LocalProbeContext = {
  repoRoot: string;
  env: NodeJS.ProcessEnv;
  overlap: OverlapTargets;
};

/**
 * Status for a path source (architecture §6.14). There is no network. Checks
 * run in a fixed order and stop at the first `failed`; nothing is written.
 */
export async function checkLocalSource(
  source: PathSource,
  destination: string,
  ctx: LocalProbeContext,
  compareFilterSets: (a: readonly string[], b: readonly string[]) => boolean,
): Promise<StatusOutcome> {
  // 1. Never synced.
  const marker = await readProvenanceMarker(destination);
  if (!marker) {
    return { name: source.name, kind: "path", verdict: "behind", reasons: ["never-synced"] };
  }
  const base = recordedBase(source.name, marker);

  // 2–3. Expansion failure → failed; missing directory → failed / source-missing.
  try {
    base.sourcePath = (await expandSourcePath(source.name, source.path, ctx)).real;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof MaesterError && err.code === "SOURCE_PATH_MISSING") {
      return { ...base, verdict: "failed", reason: "source-missing", error: message };
    }
    return { ...base, verdict: "failed", error: message };
  }

  // 4. Link mode: any dangling link means the originals moved.
  if (marker.mode === "link") {
    const dangling = await findDanglingLinks(destination);
    if (dangling.length > 0) {
      return {
        ...base,
        verdict: "failed",
        reason: "source-missing",
        error: danglingMessage(dangling),
      };
    }
  }

  // 5–6. Re-resolve read-only and compare with what the last sync recorded.
  let tree: Awaited<ReturnType<typeof fetchLocalSource>>;
  try {
    tree = await fetchLocalSource(source, ctx);
  } catch (err) {
    return { ...base, verdict: "failed", error: err instanceof Error ? err.message : String(err) };
  }
  const reasons: BehindReason[] = [];
  const sameSource =
    marker.kind === "path" &&
    marker.sourcePath === tree.sourcePath &&
    marker.fingerprint === tree.fingerprint;
  if (!sameSource) reasons.push("local-changed");
  const filterModeMoved = marker.filterMode !== undefined && marker.filterMode !== tree.filterMode;
  if (
    filterModeMoved ||
    !compareFilterSets(marker.filterSet, tree.filterSet) ||
    !compareFilterSets(marker.excludes ?? [], tree.excludes ?? [])
  ) {
    reasons.push("manifest-changed");
  }

  // 7.
  if (reasons.length === 0) return { ...base, verdict: "up-to-date" };
  return { ...base, verdict: "behind", reasons };
}

function recordedBase(name: string, marker: ProvenanceMarker): StatusOutcomeBase {
  const base: StatusOutcomeBase = { name, kind: "path", mode: marker.mode };
  if (marker.filterMode) base.filterMode = marker.filterMode;
  return base;
}

function danglingMessage(dangling: readonly string[]): string {
  const shown = dangling.slice(0, DANGLING_LIST_LIMIT).join(", ");
  const more =
    dangling.length > DANGLING_LIST_LIMIT
      ? ` and ${dangling.length - DANGLING_LIST_LIMIT} more`
      : "";
  return `${dangling.length} linked file(s) no longer resolve (${shown}${more}) — the source directory moved or files were removed; run \`maester sync\``;
}
