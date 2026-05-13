import { resolve } from "node:path";
import type { CitadelConfig, Source } from "../../schemas/citadel.js";
import { CACHE_DIR_NAME, defaultDestinationFor } from "../config/paths.js";
import { writeCitadelConfig } from "../config/writer.js";
import { appendMissingGitignoreEntries } from "../repo/gitignore.js";
import { ensureScript } from "../repo/package-json.js";

export type FinalizeResult = {
  citadelPath: string;
  gitignoreAdded: string[];
  packageJsonScript: "no-package-json" | "already-set" | "added";
};

export type FinalizeInput = {
  sources: Source[];
  baseDir?: string;
};

export async function finalizeCitadel(
  repoRoot: string,
  input: FinalizeInput,
): Promise<FinalizeResult> {
  detectDestinationCollisions(repoRoot, input);
  const config: CitadelConfig = {
    schemaVersion: 1,
    ...(input.baseDir ? { baseDir: input.baseDir } : {}),
    sources: input.sources,
  };
  const citadelPath = await writeCitadelConfig(repoRoot, config);
  const gitignore = await appendMissingGitignoreEntries(repoRoot, [`${CACHE_DIR_NAME}/`]);
  const script = await ensureScript(repoRoot, "maester:sync", "maester sync");
  return {
    citadelPath,
    gitignoreAdded: gitignore.added,
    packageJsonScript: script.reason,
  };
}

type EntryDescriptor = {
  name: string;
  destination: string | undefined;
};

export function detectDestinationCollisions(
  repoRoot: string,
  input: FinalizeInput | EntryDescriptor[],
  baseDirArg?: string,
): void {
  const baseDir = Array.isArray(input) ? baseDirArg : input.baseDir;
  const entries: EntryDescriptor[] = Array.isArray(input)
    ? input
    : input.sources.map((s): EntryDescriptor => ({ name: s.name, destination: s.destination }));

  const byDest = new Map<string, { name: string }>();
  for (const entry of entries) {
    const dest = entry.destination
      ? resolve(repoRoot, entry.destination)
      : defaultDestinationFor(repoRoot, entry.name, baseDir);
    const prior = byDest.get(dest);
    if (prior) {
      throw new Error(
        `sources '${entry.name}' and '${prior.name}' both resolve to destination '${dest}'. Set a unique destination for one of them.`,
      );
    }
    byDest.set(dest, { name: entry.name });
  }
}
