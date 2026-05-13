import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const PROVENANCE_FILENAME = ".maester-source.json";

export type ProvenanceMarker = {
  kind: "maester" | "raven";
  sourceName: string;
  sourceUrl: string;
  ref: string | undefined;
  commitSha: string;
  filterSet?: readonly string[] | "all";
  syncedAt: string;
};

export async function writeProvenanceMarker(
  destination: string,
  marker: ProvenanceMarker,
): Promise<string> {
  const path = resolve(destination, PROVENANCE_FILENAME);
  const body = `${JSON.stringify(marker, null, 2)}\n`;
  await writeFile(path, body, "utf8");
  return path;
}

export async function readProvenanceMarker(
  destination: string,
): Promise<ProvenanceMarker | undefined> {
  const path = resolve(destination, PROVENANCE_FILENAME);
  if (!existsSync(path)) return undefined;
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return normalizeMarker(parsed);
  } catch {
    return undefined;
  }
}

function normalizeMarker(parsed: Record<string, unknown>): ProvenanceMarker | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;

  // New shape — already has kind + sourceName.
  if (typeof parsed.kind === "string" && typeof parsed.sourceName === "string") {
    return parsed as ProvenanceMarker;
  }

  // Legacy shape from the maester-only build — promote to the new shape with
  // filterSet undefined so the runner treats it as filter-set drift and
  // re-checks out. This is safe (re-fetch is idempotent) and self-healing.
  if (typeof parsed.maesterName === "string") {
    return {
      kind: "maester",
      sourceName: parsed.maesterName as string,
      sourceUrl: (parsed.sourceUrl as string) ?? "",
      ref: (parsed.ref as string | undefined) ?? undefined,
      commitSha: (parsed.commitSha as string) ?? "",
      syncedAt: (parsed.syncedAt as string) ?? new Date(0).toISOString(),
    };
  }

  return undefined;
}

export function filterSetMatches(
  a: readonly string[] | "all" | undefined,
  b: readonly string[] | "all" | undefined,
): boolean {
  if (a === undefined || b === undefined) return false;
  if (a === "all" && b === "all") return true;
  if (a === "all" || b === "all") return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
