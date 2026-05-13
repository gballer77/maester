import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CitadelConfig, MaesterSource } from "../../schemas/citadel.js";
import { resolveAuth } from "../auth/resolver.js";
import { CACHE_SUBDIR, cachePathForSource, defaultDestinationFor } from "../config/paths.js";
import { AuthError, MaesterError, RefNotFoundError } from "../errors.js";
import {
  checkoutRef,
  clearWorktree,
  fetchHead,
  setSparsePatterns,
  shallowSparseClone,
} from "../git/client.js";
import { discoverManifestFromCache } from "./filters.js";
import { readProvenanceMarker } from "./provenance.js";
import { stageDestination } from "./stage.js";

export type SyncStatus = "added" | "updated" | "unchanged" | "failed";

export type SyncOutcome = {
  name: string;
  status: SyncStatus;
  destination: string;
  ref: string | undefined;
  commitSha?: string;
  filterMode?: "manifest" | "no-manifest";
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
  onProgress?: (event: ProgressEvent) => void;
};

export type ProgressEvent =
  | { type: "start"; source: string }
  | { type: "fetched"; source: string; commitSha: string }
  | { type: "staged"; source: string; status: SyncStatus }
  | { type: "failed"; source: string; error: string };

const DEFAULT_CONCURRENCY = 4;

export async function runSync(config: CitadelConfig, options: SyncOptions): Promise<SyncResult> {
  const env = options.env ?? process.env;
  const scope = options.scope?.length ? new Set(options.scope) : undefined;

  if (scope) {
    const known = new Set([
      ...config.maesters.map((s) => s.name),
      ...config.ravens.map((s) => s.name),
    ]);
    for (const name of scope) {
      if (!known.has(name)) {
        throw new MaesterError(
          "UNKNOWN_SOURCE",
          `Unknown source '${name}' — not declared in citadel.yaml.`,
        );
      }
    }
  }

  const sources = config.maesters.filter((s) => !scope || scope.has(s.name));
  const limit = Math.min(
    Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY),
    sources.length || 1,
  );
  const outcomes: SyncOutcome[] = new Array(sources.length);

  await mkdir(resolve(options.repoRoot, CACHE_SUBDIR), { recursive: true });

  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < limit; i++) {
    workers.push(
      (async () => {
        while (true) {
          const index = cursor++;
          if (index >= sources.length) return;
          const source = sources[index];
          if (!source) return;
          outcomes[index] = await processSource(source, options, env);
        }
      })(),
    );
  }
  await Promise.all(workers);

  const failed = outcomes.filter((o) => o.status === "failed").length;
  return { outcomes, failed };
}

async function processSource(
  source: MaesterSource,
  options: SyncOptions,
  env: NodeJS.ProcessEnv,
): Promise<SyncOutcome> {
  const cacheDir = cachePathForSource(options.repoRoot, source.name);
  const destination = source.destination
    ? resolve(options.repoRoot, source.destination)
    : defaultDestinationFor(options.repoRoot, source.name);

  options.onProgress?.({ type: "start", source: source.name });

  try {
    const auth = resolveAuth(source.auth, env);
    const tokenForUrl = auth.type === "token" ? auth.value : undefined;

    const cacheExists = existsSync(cacheDir);
    let commitSha: string;
    if (!cacheExists) {
      const cloneArgs = {
        url: source.url,
        destination: cacheDir,
        ref: source.ref,
        ...(tokenForUrl ? { useTokenInUrl: tokenForUrl } : {}),
      };
      await shallowSparseClone(cloneArgs);
      await setSparsePatterns(cacheDir, ["maester.yaml"]);
      commitSha = await checkoutRef(cacheDir, source.ref);
    } else {
      commitSha = await fetchHead(cacheDir, source.ref);
    }

    const existingMarker = await readProvenanceMarker(destination);
    const wasUnchanged =
      existingMarker?.commitSha === commitSha &&
      existingMarker.maesterName === source.name &&
      existsSync(destination);

    const discovery = await discoverManifestFromCache(cacheDir);
    let filterMode: "manifest" | "no-manifest";
    if (discovery.mode === "manifest") {
      filterMode = "manifest";
      await setSparsePatterns(cacheDir, discovery.patterns);
    } else {
      filterMode = "no-manifest";
      await setSparsePatterns(cacheDir, []);
    }
    if (cacheExists) {
      await checkoutRef(cacheDir, source.ref);
    } else {
      await checkoutRef(cacheDir, source.ref);
    }

    options.onProgress?.({ type: "fetched", source: source.name, commitSha });

    if (wasUnchanged) {
      options.onProgress?.({ type: "staged", source: source.name, status: "unchanged" });
      return {
        name: source.name,
        status: "unchanged",
        destination,
        ref: source.ref,
        commitSha,
        filterMode,
      };
    }

    await stageDestination({
      cacheDir,
      destination,
      patterns:
        filterMode === "manifest" && discovery.mode === "manifest" ? discovery.patterns : "all",
      marker: {
        maesterName: source.name,
        sourceUrl: source.url,
        ref: source.ref,
        commitSha,
        syncedAt: new Date().toISOString(),
      },
    });

    const status: SyncStatus = existingMarker ? "updated" : "added";
    options.onProgress?.({ type: "staged", source: source.name, status });
    return {
      name: source.name,
      status,
      destination,
      ref: source.ref,
      commitSha,
      filterMode,
    };
  } catch (err) {
    const message = errorMessage(err);
    options.onProgress?.({ type: "failed", source: source.name, error: message });
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
