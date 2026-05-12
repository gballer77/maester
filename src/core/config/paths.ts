import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const CITADEL_CONFIG_FILENAME = "citadel.yaml";
export const MAESTER_CONFIG_FILENAME = "maester.yaml";
export const CACHE_DIR_NAME = ".maester";
export const CACHE_SUBDIR = ".maester/cache";

export function citadelConfigPath(repoRoot: string): string {
  return resolve(repoRoot, CITADEL_CONFIG_FILENAME);
}

export function maesterConfigPath(repoRoot: string): string {
  return resolve(repoRoot, MAESTER_CONFIG_FILENAME);
}

export function cachePath(repoRoot: string): string {
  return resolve(repoRoot, CACHE_SUBDIR);
}

export function cachePathForSource(repoRoot: string, sourceName: string): string {
  return resolve(repoRoot, CACHE_SUBDIR, sourceName);
}

export function defaultDestinationFor(repoRoot: string, sourceName: string): string {
  return resolve(repoRoot, "citadel", sourceName);
}

export type RepoRoles = {
  hasCitadel: boolean;
  hasMaester: boolean;
};

export function detectRoles(repoRoot: string): RepoRoles {
  return {
    hasCitadel: existsSync(citadelConfigPath(repoRoot)),
    hasMaester: existsSync(maesterConfigPath(repoRoot)),
  };
}
