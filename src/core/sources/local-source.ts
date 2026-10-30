import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { globby } from "globby";
import type { PathSource } from "../../schemas/citadel.js";
import { MaesterError } from "../errors.js";
import type { RuleEntry } from "../state/schema.js";
import type { MaterializationMode } from "../sync/provenance.js";
import { type SkippedCounts, filterWholeRepoFiles } from "./excludes.js";
import {
  type FilterMode,
  type WholeRepoReason,
  hasExplicitIncludes,
  readManifestProbe,
  resolveFilterMode,
} from "./filter-mode.js";
import { fingerprintTree } from "./fingerprint.js";
import type { FetchWarning } from "./git-source.js";
import {
  type OverlapTargets,
  checkPathOverlap,
  expandSourcePath,
  isRelativeDeclaration,
} from "./local-path.js";
import { resolveSourceMode } from "./source-mode.js";

export type LocalFetchContext = {
  repoRoot: string;
  env: NodeJS.ProcessEnv;
  /** Real (symlink-resolved) citadel base directory and destinations. */
  overlap: OverlapTargets;
  homedir?: string;
};

/** A path source resolved against its directory (architecture §6.14). */
export type LocalTree = {
  kind: "path";
  name: string;
  /** The `path` exactly as declared. */
  sourcePath: string;
  /** Real absolute directory the files are read from. */
  rootDir: string;
  /** Repo-relative declarations get relative link targets; the rest absolute. */
  relativeLinks: boolean;
  mode: MaterializationMode;
  filterMode: FilterMode;
  filterSet: readonly string[];
  rules: readonly RuleEntry[];
  /** Sorted, root-relative: the authoritative file set. */
  files: readonly string[];
  fingerprint: string;
  excludes?: readonly string[];
  wholeRepoReason?: WholeRepoReason;
  skipped?: SkippedCounts;
  warnings: FetchWarning[];
};

/**
 * Resolve a path source read-only: expand and guard the path, pick the filter
 * mode with the same precedence as git sources, list the files, and
 * fingerprint them. Nothing is written.
 */
export async function fetchLocalSource(
  entry: PathSource,
  ctx: LocalFetchContext,
): Promise<LocalTree> {
  const { real } = await expandSourcePath(entry.name, entry.path, ctx);
  const overlap = checkPathOverlap(entry.name, entry.path, real, ctx.overlap);
  if (overlap) throw new MaesterError("SOURCE_PATH_OVERLAP", overlap);

  const probe = hasExplicitIncludes(entry) ? undefined : await readManifestProbe(real);
  const resolution = resolveFilterMode(entry, probe);
  if (resolution.mode === "invalid-manifest") {
    throw new MaesterError(
      "MAESTER_MANIFEST_INVALID",
      `source '${entry.name}' has a maester.yaml that failed schema validation. Sync never treats a broken manifest as "publish everything" — fix the manifest in ${entry.path} or declare an \`includes\` list on this source.`,
    );
  }
  const mode = resolveSourceMode(entry, resolution.mode);
  const base = {
    kind: "path" as const,
    name: entry.name,
    sourcePath: entry.path,
    rootDir: real,
    relativeLinks: isRelativeDeclaration(entry.path),
    mode,
    filterMode: resolution.mode,
  };
  const warnings: FetchWarning[] = [];

  if (resolution.mode === "whole-repository") {
    const candidates = await listWholeDirectory(real, resolution.excludes);
    const { files, skipped } = await filterWholeRepoFiles(real, candidates, resolution.excludes);
    return {
      ...base,
      filterSet: ["**"],
      rules: [],
      files,
      fingerprint: await fingerprintTree(real, files, { content: mode === "copy" }),
      excludes: resolution.excludes,
      wholeRepoReason: resolution.reason,
      skipped,
      warnings,
    };
  }

  if (entry.excludes && entry.excludes.length > 0) {
    warnings.push({ type: "excludes-ignored", name: entry.name, filterMode: resolution.mode });
  }
  const files = (
    await globby(resolution.patterns, {
      cwd: real,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
      gitignore: false,
      ignore: ["**/.git/**"],
    })
  ).sort();
  if (resolution.mode === "includes" && files.length === 0) {
    warnings.push({ type: "no-matches", name: entry.name, includes: resolution.patterns });
  }
  return {
    ...base,
    filterSet: resolution.patterns,
    rules: resolution.rules,
    files,
    fingerprint: await fingerprintTree(real, files, { content: mode === "copy" }),
    warnings,
  };
}

/**
 * Whole-directory candidates (architecture §6.13): excludes are passed as
 * `ignore` so excluded trees such as `node_modules/` are never walked.
 * Symlinked files are dropped, as in git whole-repository mode, so a link
 * never points outside the source directory.
 */
async function listWholeDirectory(root: string, excludes: readonly string[]): Promise<string[]> {
  const entries = await globby(["**"], {
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    gitignore: false,
    ignore: [...excludes],
  });
  const files: string[] = [];
  for (const file of entries) {
    if (!(await lstat(resolve(root, file))).isSymbolicLink()) files.push(file);
  }
  return files.sort();
}
