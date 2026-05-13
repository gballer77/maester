import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CitadelConfig, Source } from "../../schemas/citadel.js";
import { resolveAuth } from "../auth/resolver.js";
import { CACHE_SUBDIR, cachePathForSource, defaultDestinationFor } from "../config/paths.js";
import { AuthError, MaesterError, RefNotFoundError } from "../errors.js";
import { clearWorktree } from "../git/client.js";
import { type FetchWarning, type FetchedTree, fetchSource } from "../sources/fetcher.js";
import {
  type StateApplyDetail,
  type StateApplyResult,
  type StateBreakdown,
  type StateWarning,
  applyState,
} from "../state/applier.js";
import { filterSetMatches, readProvenanceMarker } from "./provenance.js";
import { stageDestination } from "./stage.js";

export type SyncStatus = "added" | "updated" | "unchanged" | "failed";

export type SyncOutcome = {
  name: string;
  status: SyncStatus;
  destination: string;
  ref: string | undefined;
  commitSha?: string;
  warnings: FetchWarning[];
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
  | { type: "warning"; name: string; warning: FetchWarning }
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

  try {
    const auth = resolveAuth(source.auth, env);
    const tokenForUrl = auth.type === "token" ? auth.value : undefined;
    const cacheExists = existsSync(cacheDir);

    const tree: FetchedTree = await fetchSource(source, {
      cacheDir,
      cacheExists,
      tokenForUrl,
    });

    options.onProgress?.({ type: "fetched", name: source.name, commitSha: tree.commitSha });
    for (const warning of tree.warnings) {
      options.onProgress?.({ type: "warning", name: source.name, warning });
    }

    const existingMarker = await readProvenanceMarker(destination);
    const wasUnchanged =
      !!existingMarker &&
      existingMarker.commitSha === tree.commitSha &&
      existingMarker.sourceName === source.name &&
      filterSetMatches(existingMarker.filterSet, tree.filterSet) &&
      existsSync(destination);

    if (wasUnchanged) {
      options.onProgress?.({ type: "staged", name: source.name, status: "unchanged" });
      return {
        name: source.name,
        status: "unchanged",
        destination,
        ref: source.ref,
        commitSha: tree.commitSha,
        warnings: tree.warnings,
      };
    }

    const stageResult = await stageDestination<StateApplyResult>({
      cacheDir: tree.cacheDir,
      destination,
      marker: {
        sourceName: tree.name,
        sourceUrl: source.url,
        ref: source.ref,
        commitSha: tree.commitSha,
        filterSet: tree.filterSet,
        syncedAt: new Date().toISOString(),
      },
      beforePromote: (stagedDir) => applyState(stagedDir, tree.rules),
    });
    const stateResult = stageResult.beforePromoteResult;

    const status: SyncStatus = existingMarker ? "updated" : "added";
    options.onProgress?.({ type: "staged", name: source.name, status });
    return {
      name: source.name,
      status,
      destination,
      ref: source.ref,
      commitSha: tree.commitSha,
      warnings: tree.warnings,
      ...(stateResult
        ? {
            stateBreakdown: stateResult.breakdown,
            stateWarnings: stateResult.warnings,
            stateDetails: stateResult.details,
          }
        : {}),
    };
  } catch (err) {
    const message = errorMessage(err);
    options.onProgress?.({ type: "failed", name: source.name, error: message });
    try {
      await clearWorktree(cacheDir);
    } catch {
      /* ignore */
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

function errorMessage(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof RefNotFoundError) return err.message;
  if (err instanceof MaesterError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
