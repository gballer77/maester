import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const PROVENANCE_FILENAME = ".maester-source.json";

export type ProvenanceMarker = {
  sourceName: string;
  sourceUrl: string;
  ref: string | undefined;
  commitSha: string;
  filterSet: readonly string[];
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
    if (
      typeof parsed.sourceName !== "string" ||
      typeof parsed.sourceUrl !== "string" ||
      typeof parsed.commitSha !== "string" ||
      !Array.isArray(parsed.filterSet)
    ) {
      return undefined;
    }
    return {
      sourceName: parsed.sourceName,
      sourceUrl: parsed.sourceUrl,
      ref: typeof parsed.ref === "string" ? parsed.ref : undefined,
      commitSha: parsed.commitSha,
      filterSet: parsed.filterSet as readonly string[],
      syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : new Date(0).toISOString(),
    };
  } catch {
    return undefined;
  }
}

export function filterSetMatches(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
