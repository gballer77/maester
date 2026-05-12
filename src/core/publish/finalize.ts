import type { MaesterConfig, PublishedDocument } from "../../schemas/maester.js";
import { writeMaesterConfig } from "../config/writer.js";

export type PublishFinalizeResult = {
  maesterPath: string;
  documentCount: number;
};

export async function finalizeMaesterManifest(
  repoRoot: string,
  documents: PublishedDocument[],
): Promise<PublishFinalizeResult> {
  detectDuplicatePaths(documents);
  const config: MaesterConfig = { schemaVersion: 1, documents };
  const path = await writeMaesterConfig(repoRoot, config);
  return { maesterPath: path, documentCount: documents.length };
}

export function detectDuplicatePaths(documents: readonly PublishedDocument[]): void {
  const seen = new Map<string, number>();
  for (let i = 0; i < documents.length; i++) {
    const p = documents[i]?.path;
    if (!p) continue;
    if (seen.has(p)) {
      throw new Error(`Duplicate path '${p}' (also at index ${seen.get(p)}).`);
    }
    seen.set(p, i);
  }
}
