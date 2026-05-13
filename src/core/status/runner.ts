import { resolve } from "node:path";
import type { CitadelConfig, Source } from "../../schemas/citadel.js";
import { resolveAuth } from "../auth/resolver.js";
import { defaultDestinationFor } from "../config/paths.js";
import { AuthError, MaesterError, RefNotFoundError } from "../errors.js";
import { readProvenanceMarker } from "../sync/provenance.js";
import { type ProbeContext, probeCommitSha, probeManifest } from "./probe.js";

export type StatusVerdict = "up-to-date" | "behind" | "failed";

export type BehindReason = "never-synced" | "remote-ref-advanced" | "manifest-changed";

export type StatusOutcome =
  | { name: string; verdict: "up-to-date"; commitSha: string }
  | {
      name: string;
      verdict: "behind";
      reasons: readonly BehindReason[];
      commitSha?: string;
      resolvedSha?: string;
    }
  | { name: string; verdict: "failed"; error: string };

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
          outcomes[index] = await checkSource(entry, options, env, baseDir);
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
): Promise<StatusOutcome> {
  const destination = source.destination
    ? resolve(options.repoRoot, source.destination)
    : defaultDestinationFor(options.repoRoot, source.name, baseDir);

  const marker = await readProvenanceMarker(destination);
  if (!marker) {
    return {
      name: source.name,
      verdict: "behind",
      reasons: ["never-synced"],
    };
  }

  try {
    const auth = resolveAuth(source.auth, env);
    const tokenForUrl = auth.type === "token" ? auth.value : undefined;
    const probeCtx: ProbeContext = { repoRoot: options.repoRoot, tokenForUrl };

    const resolvedSha = await probeCommitSha(source, probeCtx);

    const reasons: BehindReason[] = [];
    if (resolvedSha !== marker.commitSha) {
      reasons.push("remote-ref-advanced");
    }

    const isManifestDriven = !source.includes || source.includes.length === 0;
    if (isManifestDriven) {
      const { filterSet } = await probeManifest(source, probeCtx);
      if (!filterSetsEqual(filterSet, marker.filterSet)) {
        reasons.push("manifest-changed");
      }
    }

    if (reasons.length === 0) {
      return {
        name: source.name,
        verdict: "up-to-date",
        commitSha: resolvedSha,
      };
    }
    return {
      name: source.name,
      verdict: "behind",
      reasons,
      commitSha: marker.commitSha,
      resolvedSha,
    };
  } catch (err) {
    return {
      name: source.name,
      verdict: "failed",
      error: errorMessage(err),
    };
  }
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
