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
import { isUnderAny, localSubmodules, submoduleReached } from "./submodules.js";

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
    const filtered = await filterWholeRepoFiles(real, candidates, resolution.excludes);
    const { skipped } = filtered;
    const files = await applySubmodulePolicy(entry, real, filtered.files, () => true, warnings);
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
  const files = await applySubmodulePolicy(
    entry,
    real,
    await resolveManifestFiles(real, resolution.patterns),
    (path) => submoduleReached(path, resolution.patterns),
    warnings,
  );
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
 * Submodules in a local working tree are read as they are on disk: an
 * initialized one is plain files, an uninitialized one is an empty directory
 * that earns a warning (sync never runs git commands that change the tree).
 * With `submodules: false` files inside submodules are dropped.
 */
async function applySubmodulePolicy(
  entry: PathSource,
  root: string,
  files: readonly string[],
  reached: (path: string) => boolean,
  warnings: FetchWarning[],
): Promise<string[]> {
  const submodules = (await localSubmodules(root)).filter((s) => reached(s.path));
  if (entry.submodules === false) {
    const paths = submodules.map((s) => s.path);
    if (paths.length > 0) warnings.push({ type: "submodules-disabled", name: entry.name, paths });
    return files.filter((f) => !isUnderAny(f, paths));
  }
  for (const sub of submodules) {
    if (!sub.initialized) {
      warnings.push({ type: "submodule-uninitialized", name: entry.name, path: sub.path });
    }
  }
  return [...files];
}

/**
 * The files a list of manifest / includes patterns selects in a directory.
 * Shared with `maester publish preview` (§6.19, Gap 82) so the preview and
 * a path-source sync select exactly the same files.
 */
export async function resolveManifestFiles(
  root: string,
  patterns: readonly string[],
): Promise<string[]> {
  return (
    await globby([...patterns], {
      cwd: root,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
      gitignore: false,
      ignore: ["**/.git/**"],
    })
  ).sort();
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
    // An initialized submodule's `.git` is a file pointing at the parent's
    // git directory; the `**/.git/**` exclude only covers directories.
    if (file === ".git" || file.endsWith("/.git")) continue;
    if (!(await lstat(resolve(root, file))).isSymbolicLink()) files.push(file);
  }
  return files.sort();
}
