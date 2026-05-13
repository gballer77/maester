import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CitadelConfig, MaesterSource, RavenSource } from "../../schemas/citadel.js";
import { resolveAuth } from "../auth/resolver.js";
import { CACHE_SUBDIR, cachePathForSource, defaultDestinationFor } from "../config/paths.js";
import { AuthError, MaesterError, RefNotFoundError } from "../errors.js";
import { clearWorktree } from "../git/client.js";
import type { FetchWarning, FetchedTree, SourceFetcher } from "../sources/fetcher.js";
import { createMaesterFetcher } from "../sources/maester.js";
import { createRavenFetcher } from "../sources/raven.js";
import { filterSetMatches, readProvenanceMarker } from "./provenance.js";
import { stageDestination } from "./stage.js";

export type SyncStatus = "added" | "updated" | "unchanged" | "failed";
export type EntryKind = "maester" | "raven";

export type SyncOutcome = {
  kind: EntryKind;
  name: string;
  status: SyncStatus;
  destination: string;
  ref: string | undefined;
  commitSha?: string;
  filterMode?: "manifest" | "no-manifest";
  warnings: FetchWarning[];
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
  | { type: "start"; kind: EntryKind; name: string }
  | { type: "fetched"; kind: EntryKind; name: string; commitSha: string }
  | { type: "staged"; kind: EntryKind; name: string; status: SyncStatus }
  | { type: "warning"; kind: EntryKind; name: string; warning: FetchWarning }
  | { type: "failed"; kind: EntryKind; name: string; error: string };

type Entry = { kind: "maester"; source: MaesterSource } | { kind: "raven"; source: RavenSource };

const DEFAULT_CONCURRENCY = 4;

export async function runSync(config: CitadelConfig, options: SyncOptions): Promise<SyncResult> {
  const env = options.env ?? process.env;
  const scope = options.scope?.length ? new Set(options.scope) : undefined;

  const allEntries: Entry[] = [
    ...config.maesters.map((source): Entry => ({ kind: "maester", source })),
    ...config.ravens.map((source): Entry => ({ kind: "raven", source })),
  ];

  if (scope) {
    const known = new Set(allEntries.map((e) => e.source.name));
    for (const name of scope) {
      if (!known.has(name)) {
        throw new MaesterError(
          "UNKNOWN_SOURCE",
          `Unknown source '${name}' — not declared in citadel.yaml.`,
        );
      }
    }
  }

  const entries = allEntries.filter((e) => !scope || scope.has(e.source.name));
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
          outcomes[index] = await processEntry(entry, options, env);
        }
      })(),
    );
  }
  await Promise.all(workers);

  const failed = outcomes.filter((o) => o.status === "failed").length;
  return { outcomes, failed };
}

async function processEntry(
  entry: Entry,
  options: SyncOptions,
  env: NodeJS.ProcessEnv,
): Promise<SyncOutcome> {
  const cacheDir = cachePathForSource(options.repoRoot, entry.source.name);
  const destination = entry.source.destination
    ? resolve(options.repoRoot, entry.source.destination)
    : defaultDestinationFor(options.repoRoot, entry.source.name);

  options.onProgress?.({ type: "start", kind: entry.kind, name: entry.source.name });

  try {
    const auth = resolveAuth(entry.source.auth, env);
    const tokenForUrl = auth.type === "token" ? auth.value : undefined;
    const cacheExists = existsSync(cacheDir);

    const fetcher: SourceFetcher =
      entry.kind === "maester"
        ? createMaesterFetcher(entry.source)
        : createRavenFetcher(entry.source);

    const tree: FetchedTree = await fetcher.fetch({
      cacheDir,
      cacheExists,
      tokenForUrl,
    });

    options.onProgress?.({
      type: "fetched",
      kind: entry.kind,
      name: entry.source.name,
      commitSha: tree.commitSha,
    });
    for (const warning of tree.warnings) {
      options.onProgress?.({
        type: "warning",
        kind: entry.kind,
        name: entry.source.name,
        warning,
      });
    }

    const existingMarker = await readProvenanceMarker(destination);
    const wasUnchanged =
      !!existingMarker &&
      existingMarker.commitSha === tree.commitSha &&
      existingMarker.sourceName === entry.source.name &&
      filterSetMatches(existingMarker.filterSet, tree.filterSet) &&
      existsSync(destination);

    if (wasUnchanged) {
      options.onProgress?.({
        type: "staged",
        kind: entry.kind,
        name: entry.source.name,
        status: "unchanged",
      });
      return {
        kind: entry.kind,
        name: entry.source.name,
        status: "unchanged",
        destination,
        ref: entry.source.ref,
        commitSha: tree.commitSha,
        ...(entry.kind === "maester"
          ? { filterMode: tree.filterSet === "all" ? "no-manifest" : "manifest" }
          : {}),
        warnings: tree.warnings,
      };
    }

    await stageDestination({
      cacheDir: tree.cacheDir,
      destination,
      marker: {
        kind: tree.kind,
        sourceName: tree.name,
        sourceUrl: entry.source.url,
        ref: entry.source.ref,
        commitSha: tree.commitSha,
        filterSet: tree.filterSet,
        syncedAt: new Date().toISOString(),
      },
    });

    const status: SyncStatus = existingMarker ? "updated" : "added";
    options.onProgress?.({
      type: "staged",
      kind: entry.kind,
      name: entry.source.name,
      status,
    });
    return {
      kind: entry.kind,
      name: entry.source.name,
      status,
      destination,
      ref: entry.source.ref,
      commitSha: tree.commitSha,
      ...(entry.kind === "maester"
        ? { filterMode: tree.filterSet === "all" ? "no-manifest" : "manifest" }
        : {}),
      warnings: tree.warnings,
    };
  } catch (err) {
    const message = errorMessage(err);
    options.onProgress?.({
      type: "failed",
      kind: entry.kind,
      name: entry.source.name,
      error: message,
    });
    try {
      await clearWorktree(cacheDir);
    } catch {
      /* ignore */
    }
    return {
      kind: entry.kind,
      name: entry.source.name,
      status: "failed",
      destination,
      ref: entry.source.ref,
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
