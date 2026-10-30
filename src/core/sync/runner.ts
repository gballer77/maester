import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { CitadelConfig, Source } from "../../schemas/citadel.js";
import { resolveAuth } from "../auth/resolver.js";
import { CACHE_SUBDIR, cachePathForSource, defaultDestinationFor } from "../config/paths.js";
import { AuthError, MaesterError, RefNotFoundError } from "../errors.js";
import { clearWorktree } from "../git/client.js";
import { appendMissingGitignoreEntries, gitignoreEntryFor, isIgnored } from "../repo/gitignore.js";
import type { SkippedCounts } from "../sources/excludes.js";
import { type FetchWarning, type FetchedTree, fetchSource } from "../sources/fetcher.js";
import type { FilterMode, WholeRepoReason } from "../sources/filter-mode.js";
import {
  type StateApplyDetail,
  type StateApplyResult,
  type StateBreakdown,
  type StateWarning,
  applyState,
} from "../state/applier.js";
import { findDanglingLinks, stageLinks } from "./link.js";
import {
  type MaterializationMode,
  type ProvenanceMarker,
  filterSetMatches,
  readProvenanceMarker,
} from "./provenance.js";
import { stageDestination } from "./stage.js";

export type SyncStatus = "added" | "updated" | "unchanged" | "failed";

/**
 * Emitted when a destination's materialization changes between runs and its
 * version-control status no longer matches: copy -> link leaves previously
 * committed files tracked; link -> copy leaves the destination gitignored.
 */
export type DestinationIgnoredWarning = {
  type: "destination-ignored";
  name: string;
  transition: "copy-to-link" | "link-to-copy";
  destination: string;
};

export type SyncWarning = FetchWarning | DestinationIgnoredWarning;

export type SyncOutcome = {
  name: string;
  status: SyncStatus;
  destination: string;
  ref: string | undefined;
  commitSha?: string;
  mode?: MaterializationMode;
  filterMode?: FilterMode;
  wholeRepoReason?: WholeRepoReason;
  /** Link mode: number of files linked. */
  fileCount?: number;
  skipped?: SkippedCounts;
  /** The `.gitignore` line this run added, if any. */
  gitignoreEntry?: string;
  warnings: SyncWarning[];
  stateBreakdown?: StateBreakdown;
  stateWarnings?: StateWarning[];
  stateDetails?: StateApplyDetail[];
  error?: string;
};

export type SyncResult = {
  outcomes: SyncOutcome[];
  failed: number;
};

export type SyncOptions = {
  repoRoot: string;
  scope?: readonly string[];
  concurrency?: number;
  env?: NodeJS.ProcessEnv;
  baseDir?: string;
  onProgress?: (event: ProgressEvent) => void;
};

export type ProgressEvent =
  | { type: "start"; name: string }
  | { type: "fetched"; name: string; commitSha: string }
  | { type: "staged"; name: string; status: SyncStatus }
  | { type: "warning"; name: string; warning: SyncWarning }
  | { type: "failed"; name: string; error: string };

const DEFAULT_CONCURRENCY = 4;

export async function runSync(config: CitadelConfig, options: SyncOptions): Promise<SyncResult> {
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
  const limit = Math.min(
    Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY),
    entries.length || 1,
  );
  const outcomes: SyncOutcome[] = new Array(entries.length);

  await mkdir(resolve(options.repoRoot, CACHE_SUBDIR), { recursive: true });

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
          outcomes[index] = await processEntry(entry, options, env, baseDir);
        }
      })(),
    );
  }
  await Promise.all(workers);

  const failed = outcomes.filter((o) => o.status === "failed").length;
  return { outcomes, failed };
}

async function processEntry(
  source: Source,
  options: SyncOptions,
  env: NodeJS.ProcessEnv,
  baseDir: string | undefined,
): Promise<SyncOutcome> {
  const cacheDir = cachePathForSource(options.repoRoot, source.name);
  const destination = source.destination
    ? resolve(options.repoRoot, source.destination)
    : defaultDestinationFor(options.repoRoot, source.name, baseDir);

  options.onProgress?.({ type: "start", name: source.name });
  const existingMarker = await readProvenanceMarker(destination);

  try {
    const auth = resolveAuth(source.auth, env);
    const tree: FetchedTree = await fetchSource(source, {
      cacheDir,
      cacheExists: existsSync(cacheDir),
      tokenForUrl: auth.type === "token" ? auth.value : undefined,
    });

    options.onProgress?.({ type: "fetched", name: source.name, commitSha: tree.commitSha });
    for (const warning of tree.warnings) {
      options.onProgress?.({ type: "warning", name: source.name, warning });
    }

    const mode = resolveSourceMode(tree.filterMode);
    const outcome = await materialize(source, tree, mode, destination, existingMarker, options);
    options.onProgress?.({ type: "staged", name: source.name, status: outcome.status });
    return outcome;
  } catch (err) {
    const message = errorMessage(err);
    options.onProgress?.({ type: "failed", name: source.name, error: message });
    // A link-mode destination points into the cache; wiping it on a transient
    // failure would leave every existing link dangling.
    if (existingMarker?.mode !== "link") {
      await clearWorktree(cacheDir).catch(() => undefined);
    }
    return {
      name: source.name,
      status: "failed",
      destination,
      ref: source.ref,
      warnings: [],
      error: message,
    };
  }
}

/**
 * Git sources are copied, except in whole-repository mode, which is link-only
 * (architecture Gap 74): an undeclared publish surface never enters version
 * control.
 */
export function resolveSourceMode(filterMode: FilterMode): MaterializationMode {
  return filterMode === "whole-repository" ? "link" : "copy";
}

async function materialize(
  source: Source,
  tree: FetchedTree,
  mode: MaterializationMode,
  destination: string,
  existingMarker: ProvenanceMarker | undefined,
  options: SyncOptions,
): Promise<SyncOutcome> {
  const base = baseOutcome(source, tree, mode, destination);
  const transition = await transitionWarning(source, mode, destination, existingMarker, options);
  if (transition) base.warnings.push(transition);

  const gitignoreEntry =
    mode === "link" ? await ensureDestinationIgnored(options.repoRoot, destination) : undefined;
  if (gitignoreEntry) base.gitignoreEntry = gitignoreEntry;

  if (await isUnchanged(source, tree, mode, destination, existingMarker)) {
    return { ...base, status: "unchanged" };
  }
  const status: SyncStatus = existingMarker ? "updated" : "added";
  if (mode === "link") {
    await stageLinksFor(tree, destination, source);
    return { ...base, status };
  }
  return { ...base, status, ...(await stageCopy(source, tree, destination)) };
}

function baseOutcome(
  source: Source,
  tree: FetchedTree,
  mode: MaterializationMode,
  destination: string,
): SyncOutcome {
  const outcome: SyncOutcome = {
    name: source.name,
    status: "unchanged",
    destination,
    ref: source.ref,
    commitSha: tree.commitSha,
    mode,
    filterMode: tree.filterMode,
    warnings: [...tree.warnings],
  };
  if (tree.wholeRepoReason) outcome.wholeRepoReason = tree.wholeRepoReason;
  if (tree.skipped) outcome.skipped = tree.skipped;
  if (tree.files) outcome.fileCount = tree.files.length;
  return outcome;
}

async function isUnchanged(
  source: Source,
  tree: FetchedTree,
  mode: MaterializationMode,
  destination: string,
  marker: ProvenanceMarker | undefined,
): Promise<boolean> {
  if (!marker || !existsSync(destination)) return false;
  // A legacy marker has no filterMode; that alone is never treated as drift.
  const filterModeMatches =
    marker.filterMode === undefined || marker.filterMode === tree.filterMode;
  const sameShape =
    marker.sourceName === source.name &&
    marker.commitSha === tree.commitSha &&
    marker.mode === mode &&
    filterModeMatches &&
    filterSetMatches(marker.filterSet, tree.filterSet) &&
    filterSetMatches(marker.excludes ?? [], tree.excludes ?? []);
  if (!sameShape) return false;
  return mode === "copy" || (await findDanglingLinks(destination)).length === 0;
}

async function stageLinksFor(
  tree: FetchedTree,
  destination: string,
  source: Source,
): Promise<void> {
  await stageLinks({
    files: tree.files ?? [],
    targetRoot: tree.cacheDir,
    destination,
    // The cache lives inside the repo, so relative targets survive moving it.
    relativeTargets: true,
    marker: markerInput(source, tree, "link"),
  });
}

async function stageCopy(
  source: Source,
  tree: FetchedTree,
  destination: string,
): Promise<Partial<SyncOutcome>> {
  const stageResult = await stageDestination<StateApplyResult>({
    cacheDir: tree.cacheDir,
    destination,
    marker: markerInput(source, tree, "copy"),
    beforePromote: (stagedDir) => applyState(stagedDir, tree.rules),
  });
  const stateResult = stageResult.beforePromoteResult;
  if (!stateResult) return {};
  return {
    stateBreakdown: stateResult.breakdown,
    stateWarnings: stateResult.warnings,
    stateDetails: stateResult.details,
  };
}

function markerInput(source: Source, tree: FetchedTree, mode: MaterializationMode) {
  return {
    sourceName: tree.name,
    sourceUrl: source.url,
    ref: source.ref,
    commitSha: tree.commitSha,
    mode,
    filterMode: tree.filterMode,
    filterSet: tree.filterSet,
    ...(tree.excludes ? { excludes: tree.excludes } : {}),
    syncedAt: new Date().toISOString(),
  };
}

/** Append `/<destination>/` to `.gitignore` unless already covered. Returns the added line. */
async function ensureDestinationIgnored(
  repoRoot: string,
  destination: string,
): Promise<string | undefined> {
  const rel = relative(repoRoot, destination);
  if (await isIgnored(repoRoot, rel)) return undefined;
  const entry = gitignoreEntryFor(rel);
  const { added } = await appendMissingGitignoreEntries(repoRoot, [entry]);
  return added.length > 0 ? entry : undefined;
}

async function transitionWarning(
  source: Source,
  mode: MaterializationMode,
  destination: string,
  marker: ProvenanceMarker | undefined,
  options: SyncOptions,
): Promise<DestinationIgnoredWarning | undefined> {
  if (!marker || marker.mode === mode) return undefined;
  const rel = relative(options.repoRoot, destination);
  if (mode === "copy" && !(await isIgnored(options.repoRoot, rel))) return undefined;
  return {
    type: "destination-ignored",
    name: source.name,
    transition: mode === "link" ? "copy-to-link" : "link-to-copy",
    destination: rel,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof RefNotFoundError) return err.message;
  if (err instanceof MaesterError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
