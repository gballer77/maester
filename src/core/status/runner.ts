import { resolve } from "node:path";
import {
  type CitadelConfig,
  DEFAULT_BASE_DIR,
  type GitSource,
  type Source,
  isGitSource,
  isPathSource,
} from "../../schemas/citadel.js";
import { resolveAuth } from "../auth/resolver.js";
import { defaultDestinationFor } from "../config/paths.js";
import { AuthError, MaesterError, RefNotFoundError } from "../errors.js";
import { type FilterMode, hasExplicitIncludes } from "../sources/filter-mode.js";
import { type OverlapTargets, realOverlapTargets } from "../sources/local-path.js";
import { findDanglingLinks } from "../sync/link.js";
import {
  type MaterializationMode,
  type ProvenanceMarker,
  readProvenanceMarker,
} from "../sync/provenance.js";
import { checkLocalSource } from "./local-probe.js";
import { type ProbeContext, probeCommitSha, probeManifest } from "./probe.js";

export type StatusVerdict = "up-to-date" | "behind" | "failed";

export type BehindReason =
  | "never-synced"
  | "remote-ref-advanced"
  | "cache-missing"
  | "local-changed"
  | "manifest-changed";

/** Path sources only: the source directory or a linked original is gone. */
export type FailedReason = "source-missing";

/**
 * Fields on every outcome. `mode` / `filterMode` come from the last sync's
 * marker and are absent for a never-synced source rather than guessed.
 */
export type StatusOutcomeBase = {
  name: string;
  kind: "git" | "path";
  mode?: MaterializationMode;
  filterMode?: FilterMode;
  /** Path sources: the resolved absolute directory. */
  sourcePath?: string;
};

export type StatusOutcome =
  | (StatusOutcomeBase & { verdict: "up-to-date"; commitSha?: string })
  | (StatusOutcomeBase & {
      verdict: "behind";
      reasons: readonly BehindReason[];
      commitSha?: string;
      resolvedSha?: string;
    })
  | (StatusOutcomeBase & { verdict: "failed"; error: string; reason?: FailedReason });

export type StatusCounts = {
  upToDate: number;
  behind: number;
  failed: number;
};

export type StatusResult = {
  outcomes: StatusOutcome[];
  counts: StatusCounts;
};

export type StatusOptions = {
  repoRoot: string;
  scope?: readonly string[];
  concurrency?: number;
  env?: NodeJS.ProcessEnv;
  baseDir?: string;
};

const DEFAULT_CONCURRENCY = 4;

export async function runStatus(
  config: CitadelConfig,
  options: StatusOptions,
): Promise<StatusResult> {
  const env = options.env ?? process.env;
  const scope = options.scope?.length ? new Set(options.scope) : undefined;
  const baseDir = options.baseDir ?? config.baseDir;

  if (scope) {
    const known = new Set(config.sources.map((s) => s.name));
    for (const name of scope) {
      if (!known.has(name)) {
        throw new MaesterError(
          "UNKNOWN_SOURCE",
          `Unknown source '${name}' — not declared in citadel.yaml.`,
        );
      }
    }
  }

  const entries = config.sources.filter((s) => !scope || scope.has(s.name));
  if (entries.length === 0) {
    return { outcomes: [], counts: { upToDate: 0, behind: 0, failed: 0 } };
  }

  const limit = Math.min(Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY), entries.length);
  const overlap = await realOverlapTargets(
    options.repoRoot,
    baseDir ?? DEFAULT_BASE_DIR,
    config.sources,
  );
  const outcomes: StatusOutcome[] = new Array(entries.length);

  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < limit; i++) {
    workers.push(
      (async () => {
        while (true) {
          const index = cursor++;
          if (index >= entries.length) return;
          const entry = entries[index];
          if (!entry) return;
          outcomes[index] = await checkSource(entry, options, env, baseDir, overlap);
        }
      })(),
    );
  }
  await Promise.all(workers);

  const counts: StatusCounts = { upToDate: 0, behind: 0, failed: 0 };
  for (const outcome of outcomes) {
    if (outcome.verdict === "up-to-date") counts.upToDate++;
    else if (outcome.verdict === "behind") counts.behind++;
    else counts.failed++;
  }
  return { outcomes, counts };
}

async function checkSource(
  source: Source,
  options: StatusOptions,
  env: NodeJS.ProcessEnv,
  baseDir: string | undefined,
  overlap: OverlapTargets,
): Promise<StatusOutcome> {
  const destination = source.destination
    ? resolve(options.repoRoot, source.destination)
    : defaultDestinationFor(options.repoRoot, source.name, baseDir);

  if (isPathSource(source)) {
    return checkLocalSource(
      source,
      destination,
      { repoRoot: options.repoRoot, env, overlap },
      filterSetsEqual,
    );
  }
  if (!isGitSource(source)) {
    return { name: source.name, kind: "git", verdict: "failed", error: "source has no url" };
  }

  const marker = await readProvenanceMarker(destination);
  if (!marker) {
    return { name: source.name, kind: "git", verdict: "behind", reasons: ["never-synced"] };
  }
  const base = recordedBase(source.name, marker);

  // Local and cheap: a link-mode destination whose cache vanished.
  const cacheMissing = marker.mode === "link" && (await findDanglingLinks(destination)).length > 0;

  try {
    const auth = resolveAuth(source.auth, env);
    const tokenForUrl = auth.type === "token" ? auth.value : undefined;
    const probeCtx: ProbeContext = { repoRoot: options.repoRoot, tokenForUrl };

    const resolvedSha = await probeCommitSha(source, probeCtx);

    // A path-kind marker under a git source means the source changed kind;
    // there is no recorded SHA, so it reads as the remote having moved.
    const recordedSha = marker.kind === "git" ? marker.commitSha : undefined;
    const reasons: BehindReason[] = [];
    if (resolvedSha !== recordedSha) reasons.push("remote-ref-advanced");
    if (cacheMissing) reasons.push("cache-missing");
    if (await publishSurfaceChanged(source, marker, probeCtx)) reasons.push("manifest-changed");

    if (reasons.length === 0) {
      return { ...base, verdict: "up-to-date", commitSha: resolvedSha };
    }
    return {
      ...base,
      verdict: "behind",
      reasons,
      ...(recordedSha ? { commitSha: recordedSha } : {}),
      resolvedSha,
    };
  } catch (err) {
    return { ...base, verdict: "failed", error: errorMessage(err) };
  }
}

function recordedBase(name: string, marker: ProvenanceMarker): StatusOutcomeBase {
  const base: StatusOutcomeBase = { name, kind: "git", mode: marker.mode };
  if (marker.filterMode) base.filterMode = marker.filterMode;
  return base;
}

/**
 * True when the next sync would publish a different surface: the resolved
 * filter mode moved (e.g. a manifest appeared upstream), the manifest's
 * filter set changed, or a whole-repository source's effective excludes
 * changed. A legacy marker without `filterMode` only compares filter sets.
 */
async function publishSurfaceChanged(
  source: GitSource,
  marker: ProvenanceMarker,
  probeCtx: ProbeContext,
): Promise<boolean> {
  if (hasExplicitIncludes(source)) {
    return marker.filterMode !== undefined && marker.filterMode !== "includes";
  }
  const probed = await probeManifest(source, probeCtx);
  if (marker.filterMode !== undefined && marker.filterMode !== probed.filterMode) return true;
  if (!filterSetsEqual(probed.filterSet, marker.filterSet)) return true;
  if (probed.filterMode === "whole-repository") {
    return !filterSetsEqual(probed.excludes ?? [], marker.excludes ?? []);
  }
  return false;
}

export function filterSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function errorMessage(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof RefNotFoundError) return err.message;
  if (err instanceof MaesterError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
