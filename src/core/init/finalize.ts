import { resolve } from "node:path";
import type { CitadelConfig, MaesterSource, RavenSource } from "../../schemas/citadel.js";
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
  maesters: MaesterSource[];
  ravens: RavenSource[];
};

export async function finalizeCitadel(
  repoRoot: string,
  input: FinalizeInput,
): Promise<FinalizeResult> {
  detectDestinationCollisions(repoRoot, input);
  const config: CitadelConfig = {
    schemaVersion: 2,
    maesters: input.maesters,
    ravens: input.ravens,
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
  kind: "maester" | "raven";
  name: string;
  destination: string | undefined;
};

export function detectDestinationCollisions(
  repoRoot: string,
  input: FinalizeInput | EntryDescriptor[],
): void {
  const entries: EntryDescriptor[] = Array.isArray(input)
    ? input
    : [
        ...input.maesters.map(
          (m): EntryDescriptor => ({
            kind: "maester",
            name: m.name,
            destination: m.destination,
          }),
        ),
        ...input.ravens.map(
          (r): EntryDescriptor => ({
            kind: "raven",
            name: r.name,
            destination: r.destination,
          }),
        ),
      ];

  const byDest = new Map<string, { kind: "maester" | "raven"; name: string }>();
  for (const entry of entries) {
    const dest = entry.destination
      ? resolve(repoRoot, entry.destination)
      : defaultDestinationFor(repoRoot, entry.name);
    const prior = byDest.get(dest);
    if (prior) {
      throw new Error(
        `${entry.kind} '${entry.name}' and ${prior.kind} '${prior.name}' both resolve to destination '${dest}'. Set a unique destination for one of them.`,
      );
    }
    byDest.set(dest, { kind: entry.kind, name: entry.name });
  }
}
