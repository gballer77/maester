import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FilterMode } from "../sources/filter-mode.js";

export const PROVENANCE_FILENAME = ".maester-source.json";
export const PROVENANCE_MARKER_VERSION = 2;

export type MaterializationMode = "copy" | "link";

const MATERIALIZATION_MODES: readonly MaterializationMode[] = ["copy", "link"];
const FILTER_MODES: readonly FilterMode[] = ["includes", "manifest", "whole-repository"];

/**
 * v2 provenance marker (architecture §3). `kind` is a discriminator so path
 * sources can add their own variant later; today every marker is a git marker.
 */
export type ProvenanceMarker = {
  markerVersion: typeof PROVENANCE_MARKER_VERSION;
  kind: "git";
  sourceName: string;
  sourceUrl: string;
  ref: string | undefined;
  commitSha: string;
  mode: MaterializationMode;
  /** Absent only on legacy (pre-v2) markers; never treated as drift by itself. */
  filterMode: FilterMode | undefined;
  filterSet: readonly string[];
  /** Whole-repository mode only: built-in excludes followed by the source's own. */
  excludes?: readonly string[];
  syncedAt: string;
};

/** What callers supply; version and kind are stamped by the writer. */
export type ProvenanceMarkerInput = Omit<
  ProvenanceMarker,
  "markerVersion" | "kind" | "mode" | "filterMode"
> & {
  mode?: MaterializationMode;
  filterMode?: FilterMode;
};

export async function writeProvenanceMarker(
  destination: string,
  input: ProvenanceMarkerInput,
): Promise<string> {
  const path = resolve(destination, PROVENANCE_FILENAME);
  // Explicit key order keeps the committed file stable and diff-friendly.
  const body = {
    markerVersion: PROVENANCE_MARKER_VERSION,
    kind: "git",
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    ref: input.ref,
    commitSha: input.commitSha,
    mode: input.mode ?? "copy",
    filterMode: input.filterMode,
    filterSet: input.filterSet,
    excludes: input.excludes,
    syncedAt: input.syncedAt,
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
    if (
      typeof parsed.sourceName !== "string" ||
      typeof parsed.sourceUrl !== "string" ||
      typeof parsed.commitSha !== "string" ||
      !Array.isArray(parsed.filterSet)
    ) {
      return undefined;
    }
    const marker: ProvenanceMarker = {
      markerVersion: PROVENANCE_MARKER_VERSION,
      kind: "git",
      sourceName: parsed.sourceName,
      sourceUrl: parsed.sourceUrl,
      ref: typeof parsed.ref === "string" ? parsed.ref : undefined,
      commitSha: parsed.commitSha,
      mode: oneOf(parsed.mode, MATERIALIZATION_MODES) ?? "copy",
      filterMode: oneOf(parsed.filterMode, FILTER_MODES),
      filterSet: parsed.filterSet as readonly string[],
      syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : new Date(0).toISOString(),
    };
    if (Array.isArray(parsed.excludes)) marker.excludes = parsed.excludes as readonly string[];
    return marker;
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
