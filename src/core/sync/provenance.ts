import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const PROVENANCE_FILENAME = ".maester-source.json";

export type ProvenanceMarker = {
  maesterName: string;
  sourceUrl: string;
  ref: string | undefined;
  commitSha: string;
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
    return JSON.parse(text) as ProvenanceMarker;
  } catch {
    return undefined;
  }
}
