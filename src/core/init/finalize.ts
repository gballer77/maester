import { resolve } from "node:path";
import type { CitadelConfig, MaesterSource } from "../../schemas/citadel.js";
import { CACHE_DIR_NAME, defaultDestinationFor } from "../config/paths.js";
import { writeCitadelConfig } from "../config/writer.js";
import { appendMissingGitignoreEntries } from "../repo/gitignore.js";
import { ensureScript } from "../repo/package-json.js";

export type FinalizeResult = {
  citadelPath: string;
  gitignoreAdded: string[];
  packageJsonScript: "no-package-json" | "already-set" | "added";
};

export async function finalizeCitadel(
  repoRoot: string,
  sources: MaesterSource[],
): Promise<FinalizeResult> {
  detectDestinationCollisions(repoRoot, sources);
  const config: CitadelConfig = { schemaVersion: 1, sources };
  const citadelPath = await writeCitadelConfig(repoRoot, config);
  const gitignore = await appendMissingGitignoreEntries(repoRoot, [`${CACHE_DIR_NAME}/`]);
  const script = await ensureScript(repoRoot, "maester:sync", "maester sync");
  return {
    citadelPath,
    gitignoreAdded: gitignore.added,
    packageJsonScript: script.reason,
  };
}

export function detectDestinationCollisions(repoRoot: string, sources: MaesterSource[]): void {
  const byDest = new Map<string, string>();
  for (const source of sources) {
    const dest = source.destination
      ? resolve(repoRoot, source.destination)
      : defaultDestinationFor(repoRoot, source.name);
    const prior = byDest.get(dest);
    if (prior) {
      throw new Error(
        `Sources '${prior}' and '${source.name}' both resolve to destination '${dest}'. Set a unique destination for one of them.`,
      );
    }
    byDest.set(dest, source.name);
  }
}
