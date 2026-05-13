import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DestinationBlockedError } from "../errors.js";
import {
  PROVENANCE_FILENAME,
  type ProvenanceMarker,
  readProvenanceMarker,
  writeProvenanceMarker,
} from "./provenance.js";

export type StageInput<TApply = unknown> = {
  cacheDir: string;
  destination: string;
  marker: ProvenanceMarker;
  /**
   * Optional hook invoked against the staged copy AFTER the cache has been
   * copied and BEFORE the provenance marker is written + the atomic promote.
   * Used by the state-tag applier (architecture §6.8 / §9 Gap 19) — running
   * on the staged copy means a crash mid-rewrite leaves the previous promote
   * intact.
   */
  beforePromote?: (stagedDir: string) => Promise<TApply>;
};

export type StageOutcome<TApply = unknown> = {
  staged: boolean;
  finalPath: string;
  beforePromoteResult?: TApply;
};

export async function stageDestination<TApply = unknown>(
  input: StageInput<TApply>,
): Promise<StageOutcome<TApply>> {
  await assertDestinationSafe(input.destination, input.marker.sourceName);
  const tempDir = `${input.destination}.tmp-${Math.random().toString(36).slice(2, 10)}`;
  await mkdir(dirname(input.destination), { recursive: true });
  await mkdir(tempDir, { recursive: true });
  await copyCacheToTemp(input.cacheDir, tempDir);
  const beforePromoteResult = input.beforePromote ? await input.beforePromote(tempDir) : undefined;
  await writeProvenanceMarker(tempDir, input.marker);
  await promoteTempToDestination(tempDir, input.destination);
  if (beforePromoteResult !== undefined) {
    return { staged: true, finalPath: input.destination, beforePromoteResult };
  }
  return { staged: true, finalPath: input.destination };
}

async function copyCacheToTemp(cacheDir: string, tempDir: string): Promise<void> {
  if (!existsSync(cacheDir)) return;
  const entries = await readdir(cacheDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const src = resolve(cacheDir, entry.name);
    const dst = resolve(tempDir, entry.name);
    await cp(src, dst, { recursive: true, force: true, errorOnExist: false });
  }
}

async function promoteTempToDestination(tempDir: string, destination: string): Promise<void> {
  if (existsSync(destination)) {
    const backup = `${destination}.old-${Math.random().toString(36).slice(2, 10)}`;
    await rename(destination, backup);
    try {
      await rename(tempDir, destination);
    } catch (err) {
      await rename(backup, destination).catch(() => undefined);
      throw err;
    }
    await rm(backup, { recursive: true, force: true });
    return;
  }
  await rename(tempDir, destination);
}

export async function assertDestinationSafe(
  destination: string,
  expectedSourceName: string,
): Promise<void> {
  if (!existsSync(destination)) return;
  const entries = await readdir(destination);
  if (entries.length === 0) return;
  if (entries.length === 1 && entries[0] === PROVENANCE_FILENAME) {
    const marker = await readProvenanceMarker(destination);
    if (!marker || marker.sourceName === expectedSourceName) return;
  }
  const marker = await readProvenanceMarker(destination);
  if (marker && marker.sourceName === expectedSourceName) return;
  throw new DestinationBlockedError(
    destination,
    `Refusing to overwrite ${destination}: contains content that was not produced by '${expectedSourceName}'. Remove the directory or choose a different destination.`,
  );
}
