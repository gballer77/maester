import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import picomatch from "picomatch";

/**
 * Directory names skipped at any depth in whole-repository mode. Kept as bare
 * names so both the picomatch globs and the git sparse-checkout negations are
 * derived from one list and cannot drift apart.
 */
const EXCLUDED_DIR_NAMES = [
  // VCS metadata
  ".git",
  ".hg",
  ".svn",
  // Dependency / vendor directories
  "node_modules",
  "bower_components",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  "Pods",
  // Build output and caches
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".gradle",
  // This tool's own working state
  ".maester",
] as const;

const EXCLUDED_FILE_GLOBS = ["**/.DS_Store"] as const;

export const BUILTIN_EXCLUDES: readonly string[] = [
  ...EXCLUDED_DIR_NAMES.map((dir) => `**/${dir}/**`),
  ...EXCLUDED_FILE_GLOBS,
];

/**
 * Gitignore-style negations appended after `/*` in the whole-repository
 * sparse-checkout pattern set. Bandwidth optimization only — the authoritative
 * filter is `filterWholeRepoFiles()`. A bare `name/` matches that directory at
 * any depth in git's no-cone pattern dialect. `.git` is never checked out, so
 * it needs no negation.
 */
export const BUILTIN_SPARSE_NEGATIONS: readonly string[] = EXCLUDED_DIR_NAMES.filter(
  (dir) => dir !== ".git",
).map((dir) => `!${dir}/`);

export const WHOLE_REPO_MAX_FILE_BYTES = 1024 * 1024;

/** Same window git uses for its own binary heuristic. */
const BINARY_SNIFF_BYTES = 8000;

export type SkippedCounts = { excluded: number; binary: number; oversize: number };

export type WholeRepoFilterResult = {
  files: string[];
  skipped: SkippedCounts;
};

/** Effective exclude list for a source: built-ins first, then the source's own. */
export function effectiveExcludes(sourceExcludes: readonly string[] | undefined): string[] {
  return [...BUILTIN_EXCLUDES, ...(sourceExcludes ?? [])];
}

export async function isBinaryFile(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, BINARY_SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

/**
 * Apply the whole-repository filters to a root-relative file list, in order:
 * path excludes, size cap, binary sniff. Files that cannot be stat'ed (e.g. a
 * dangling symlink committed to the source repo) are counted as excluded.
 */
export async function filterWholeRepoFiles(
  root: string,
  files: readonly string[],
  excludes: readonly string[],
): Promise<WholeRepoFilterResult> {
  const isExcluded = picomatch([...excludes], { dot: true });
  const kept: string[] = [];
  const skipped: SkippedCounts = { excluded: 0, binary: 0, oversize: 0 };

  for (const file of files) {
    if (isExcluded(file)) {
      skipped.excluded++;
      continue;
    }
    const verdict = await classifyFile(resolve(root, file));
    if (verdict === "ok") kept.push(file);
    else skipped[verdict]++;
  }
  kept.sort();
  return { files: kept, skipped };
}

async function classifyFile(path: string): Promise<"ok" | keyof SkippedCounts> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return "excluded";
    if (info.size > WHOLE_REPO_MAX_FILE_BYTES) return "oversize";
    if (await isBinaryFile(path)) return "binary";
    return "ok";
  } catch {
    return "excluded";
  }
}
