import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  type CitadelConfig,
  DEFAULT_BASE_DIR,
  type Source,
  isGitSource,
  isPathSource,
} from "../../schemas/citadel.js";
import { resolveAuth } from "../auth/resolver.js";
import { CACHE_SUBDIR, cachePathForSource, defaultDestinationFor } from "../config/paths.js";
import { AuthError, MaesterError, RefNotFoundError } from "../errors.js";
import { clearWorktree } from "../git/client.js";
import { appendMissingGitignoreEntries, gitignoreEntryFor, isIgnored } from "../repo/gitignore.js";
import type { SkippedCounts } from "../sources/excludes.js";
import { type FetchWarning, type ResolvedTree, fetchSource } from "../sources/fetcher.js";
import type { FilterMode, WholeRepoReason } from "../sources/filter-mode.js";
import { type OverlapTargets, realOverlapTargets } from "../sources/local-path.js";
import { resolveSourceMode } from "../sources/source-mode.js";
import {
  type CategoryBreakdown,
  type StateApplyDetail,
  type StateApplyResult,
  type StateBreakdown,
  type StateWarning,
  type TagRollup,
  applyInlineMetadata,
} from "../state/applier.js";
import { findDanglingLinks, stageLinks } from "./link.js";
import {
  type MaterializationMode,
  type ProvenanceMarker,
  type ProvenanceMarkerInput,
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
  kind: "git" | "path";
  status: SyncStatus;
  destination: string;
  ref: string | undefined;
  commitSha?: string;
  /** Path sources: the resolved absolute directory the files were read from. */
  sourcePath?: string;
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
  categoryBreakdown?: CategoryBreakdown;
  tagRollup?: TagRollup;
  /** Bad-inline and disagreement warnings for state, category and tags. */
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
  | { type: "fetched"; name: string; commitSha?: string }
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
  // Built from every configured source (not just the scoped ones): a path
  // source must not overlap any destination in the citadel.
  const run: RunContext = {
    env,
    baseDir,
    overlap: await realOverlapTargets(
      options.repoRoot,
      baseDir ?? DEFAULT_BASE_DIR,
      config.sources,
    ),
  };

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
          outcomes[index] = await processEntry(entry, options, run);
        }
      })(),
    );
  }
  await Promise.all(workers);

  const failed = outcomes.filter((o) => o.status === "failed").length;
  return { outcomes, failed };
}

type RunContext = {
  env: NodeJS.ProcessEnv;
  baseDir: string | undefined;
  overlap: OverlapTargets;
};

async function processEntry(
  source: Source,
  options: SyncOptions,
  run: RunContext,
): Promise<SyncOutcome> {
  const cacheDir = cachePathForSource(options.repoRoot, source.name);
  const destination = source.destination
    ? resolve(options.repoRoot, source.destination)
    : defaultDestinationFor(options.repoRoot, source.name, run.baseDir);

  options.onProgress?.({ type: "start", name: source.name });
  const existingMarker = await readProvenanceMarker(destination);

  try {
    const auth = resolveAuth(source.auth, run.env);
    const tree = await fetchSource(source, {
      cacheDir,
      cacheExists: existsSync(cacheDir),
      tokenForUrl: auth.type === "token" ? auth.value : undefined,
      local: { repoRoot: options.repoRoot, env: run.env, overlap: run.overlap },
    });

    options.onProgress?.({
      type: "fetched",
      name: source.name,
      ...(tree.kind === "git" ? { commitSha: tree.commitSha } : {}),
    });
    for (const warning of tree.warnings) {
      options.onProgress?.({ type: "warning", name: source.name, warning });
    }

    const mode = tree.kind === "path" ? tree.mode : resolveSourceMode(source, tree.filterMode);
    const outcome = await materialize(source, tree, mode, destination, existingMarker, options);
    options.onProgress?.({ type: "staged", name: source.name, status: outcome.status });
    return outcome;
  } catch (err) {
    const message = errorMessage(err);
    options.onProgress?.({ type: "failed", name: source.name, error: message });
    // Path sources have no cache. A link-mode git destination points into its
    // cache; wiping that on a transient failure would dangle every link.
    if (isGitSource(source) && existingMarker?.mode !== "link") {
      await clearWorktree(cacheDir).catch(() => undefined);
    }
    return {
      name: source.name,
      kind: isPathSource(source) ? "path" : "git",
      status: "failed",
      destination,
      ref: source.ref,
      warnings: [],
      error: message,
    };
  }
}

async function materialize(
  source: Source,
  tree: ResolvedTree,
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
    await stageLinks({
      files: tree.files ?? [],
      targetRoot: contentRoot(tree),
      destination,
      // The git cache lives inside the repo, so relative targets survive
      // moving it; path sources are relative only when declared that way.
      relativeTargets: tree.kind === "git" || tree.relativeLinks,
      marker: markerInput(source, tree, "link"),
    });
    return { ...base, status };
  }
  return { ...base, status, ...(await stageCopy(source, tree, destination)) };
}

function contentRoot(tree: ResolvedTree): string {
  return tree.kind === "git" ? tree.cacheDir : tree.rootDir;
}

function baseOutcome(
  source: Source,
  tree: ResolvedTree,
  mode: MaterializationMode,
  destination: string,
): SyncOutcome {
  const outcome: SyncOutcome = {
    name: source.name,
    kind: tree.kind,
    status: "unchanged",
    destination,
    ref: source.ref,
    mode,
    filterMode: tree.filterMode,
    warnings: [...tree.warnings],
  };
  if (tree.kind === "git") outcome.commitSha = tree.commitSha;
  else outcome.sourcePath = tree.rootDir;
  if (tree.wholeRepoReason) outcome.wholeRepoReason = tree.wholeRepoReason;
  if (tree.skipped) outcome.skipped = tree.skipped;
  if (tree.files) outcome.fileCount = tree.files.length;
  return outcome;
}

/**
 * `unchanged` when the marker records the same source identity (git: commit;
 * path: declared path + fingerprint), materialization, and filter shape — and,
 * in link mode, every link still resolves.
 */
async function isUnchanged(
  source: Source,
  tree: ResolvedTree,
  mode: MaterializationMode,
  destination: string,
  marker: ProvenanceMarker | undefined,
): Promise<boolean> {
  if (!marker || !existsSync(destination)) return false;
  const sameIdentity =
    marker.kind === "git" && tree.kind === "git"
      ? marker.commitSha === tree.commitSha
      : marker.kind === "path" && tree.kind === "path"
        ? marker.sourcePath === tree.sourcePath && marker.fingerprint === tree.fingerprint
        : false;
  // A legacy marker has no filterMode; that alone is never treated as drift.
  const filterModeMatches =
    marker.filterMode === undefined || marker.filterMode === tree.filterMode;
  const sameShape =
    sameIdentity &&
    marker.sourceName === source.name &&
    marker.mode === mode &&
    filterModeMatches &&
    filterSetMatches(marker.filterSet, tree.filterSet) &&
    filterSetMatches(marker.excludes ?? [], tree.excludes ?? []);
  if (!sameShape) return false;
  return mode === "copy" || (await findDanglingLinks(destination)).length === 0;
}

async function stageCopy(
  source: Source,
  tree: ResolvedTree,
  destination: string,
): Promise<Partial<SyncOutcome>> {
  const stageResult = await stageDestination<StateApplyResult>({
    cacheDir: contentRoot(tree),
    // A git cache is already narrowed by sparse checkout; a path source's
    // directory is not, so only its resolved files are copied.
    ...(tree.kind === "path" ? { files: tree.files } : {}),
    destination,
    marker: markerInput(source, tree, "copy"),
    beforePromote: (stagedDir) => applyInlineMetadata(stagedDir, tree.rules),
  });
  const stateResult = stageResult.beforePromoteResult;
  if (!stateResult) return {};
  return {
    stateBreakdown: stateResult.breakdown,
    categoryBreakdown: stateResult.categoryBreakdown,
    tagRollup: stateResult.tagRollup,
    stateWarnings: stateResult.warnings,
    stateDetails: stateResult.details,
  };
}

function markerInput(
  source: Source,
  tree: ResolvedTree,
  mode: MaterializationMode,
): ProvenanceMarkerInput {
  const shared = {
    sourceName: tree.name,
    mode,
    filterMode: tree.filterMode,
    filterSet: tree.filterSet,
    ...(tree.excludes ? { excludes: tree.excludes } : {}),
    syncedAt: new Date().toISOString(),
  };
  if (tree.kind === "path") {
    return {
      ...shared,
      kind: "path",
      sourcePath: tree.sourcePath,
      resolvedPath: tree.rootDir,
      fingerprint: tree.fingerprint,
      fileCount: tree.files.length,
    };
  }
  return {
    ...shared,
    kind: "git",
    sourceUrl: source.url ?? "",
    ref: source.ref,
    commitSha: tree.commitSha,
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
