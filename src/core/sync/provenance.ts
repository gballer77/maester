import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FilterMode } from "../sources/filter-mode.js";

export const PROVENANCE_FILENAME = ".maester-source.json";
export const PROVENANCE_MARKER_VERSION = 2;

export type MaterializationMode = "copy" | "link";

const MATERIALIZATION_MODES: readonly MaterializationMode[] = ["copy", "link"];
const FILTER_MODES: readonly FilterMode[] = ["includes", "manifest", "whole-repository"];

type MarkerCommon = {
  markerVersion: typeof PROVENANCE_MARKER_VERSION;
  sourceName: string;
  mode: MaterializationMode;
  /** Absent only on legacy (pre-v2) markers; never treated as drift by itself. */
  filterMode: FilterMode | undefined;
  filterSet: readonly string[];
  /** Whole-repository mode only: built-in excludes followed by the source's own. */
  excludes?: readonly string[];
  syncedAt: string;
};

/** v2 provenance marker (architecture §3), discriminated on `kind`. */
export type GitProvenanceMarker = MarkerCommon & {
  kind: "git";
  sourceUrl: string;
  ref: string | undefined;
  commitSha: string;
};

export type PathProvenanceMarker = MarkerCommon & {
  kind: "path";
  /** The `path` exactly as declared in citadel.yaml; compared for `unchanged`. */
  sourcePath: string;
  /** Absolute path on the machine that wrote the marker; informational only. */
  resolvedPath: string;
  /** `sha256:<hex>` from `fingerprintTree()`. */
  fingerprint: string;
  fileCount: number;
};

export type ProvenanceMarker = GitProvenanceMarker | PathProvenanceMarker;

type InputOf<M extends ProvenanceMarker> = Omit<
  M,
  "markerVersion" | "kind" | "mode" | "filterMode"
> & {
  mode?: MaterializationMode;
  filterMode?: FilterMode;
};

/** What callers supply; the version is stamped by the writer and `kind` defaults to git. */
export type ProvenanceMarkerInput =
  | (InputOf<GitProvenanceMarker> & { kind?: "git" })
  | (InputOf<PathProvenanceMarker> & { kind: "path" });

export async function writeProvenanceMarker(
  destination: string,
  input: ProvenanceMarkerInput,
): Promise<string> {
  const path = resolve(destination, PROVENANCE_FILENAME);
  // Explicit key order keeps the committed file stable and diff-friendly.
  const head = { markerVersion: PROVENANCE_MARKER_VERSION };
  const tail = {
    mode: input.mode ?? "copy",
    filterMode: input.filterMode,
    filterSet: input.filterSet,
    excludes: input.excludes,
    syncedAt: input.syncedAt,
  };
  const body =
    input.kind === "path"
      ? {
          ...head,
          kind: "path",
          sourceName: input.sourceName,
          sourcePath: input.sourcePath,
          resolvedPath: input.resolvedPath,
          fingerprint: input.fingerprint,
          fileCount: input.fileCount,
          ...tail,
        }
      : {
          ...head,
          kind: "git",
          sourceName: input.sourceName,
          sourceUrl: input.sourceUrl,
          ref: input.ref,
          commitSha: input.commitSha,
          ...tail,
        };
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return path;
}

/**
 * Read a marker, upgrading legacy (pre-v2) markers in memory to
 * `{ kind: "git", mode: "copy", filterMode: undefined }`. Returns undefined
 * when the file is absent or missing required fields.
 */
export async function readProvenanceMarker(
  destination: string,
): Promise<ProvenanceMarker | undefined> {
  const path = resolve(destination, PROVENANCE_FILENAME);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (typeof parsed.sourceName !== "string" || !Array.isArray(parsed.filterSet)) {
      return undefined;
    }
    const common = {
      markerVersion: PROVENANCE_MARKER_VERSION,
      sourceName: parsed.sourceName,
      mode: oneOf(parsed.mode, MATERIALIZATION_MODES) ?? "copy",
      filterMode: oneOf(parsed.filterMode, FILTER_MODES),
      filterSet: parsed.filterSet as readonly string[],
      syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : new Date(0).toISOString(),
      ...(Array.isArray(parsed.excludes) ? { excludes: parsed.excludes as readonly string[] } : {}),
    } satisfies MarkerCommon;

    if (parsed.kind === "path") {
      if (typeof parsed.sourcePath !== "string" || typeof parsed.fingerprint !== "string") {
        return undefined;
      }
      return {
        ...common,
        kind: "path",
        sourcePath: parsed.sourcePath,
        resolvedPath: typeof parsed.resolvedPath === "string" ? parsed.resolvedPath : "",
        fingerprint: parsed.fingerprint,
        fileCount: typeof parsed.fileCount === "number" ? parsed.fileCount : 0,
      };
    }
    if (typeof parsed.sourceUrl !== "string" || typeof parsed.commitSha !== "string") {
      return undefined;
    }
    return {
      ...common,
      kind: "git",
      sourceUrl: parsed.sourceUrl,
      ref: typeof parsed.ref === "string" ? parsed.ref : undefined,
      commitSha: parsed.commitSha,
    };
  } catch {
    return undefined;
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function filterSetMatches(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
