import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parseDocument } from "yaml";
import type { GitSource } from "../../schemas/citadel.js";
import { MaesterConfigSchema } from "../../schemas/maester.js";
import { MaesterError } from "../errors.js";
import {
  addSparsePatterns,
  checkoutRef,
  fetchHead,
  setSparsePatterns,
  shallowSparseClone,
} from "../git/client.js";
import type { RuleEntry } from "../state/schema.js";
import { BUILTIN_SPARSE_NEGATIONS, type SkippedCounts, filterWholeRepoFiles } from "./excludes.js";
import {
  type FilterMode,
  MAESTER_MANIFEST_FILENAME,
  type WholeRepoReason,
  hasExplicitIncludes,
  readManifestProbe,
  resolveFilterMode,
} from "./filter-mode.js";
import {
  type SubmoduleFilter,
  type SubmoduleRef,
  type SubmoduleWarning,
  compileFileMatcher,
  isUnderAny,
  listGitlinks,
  pruneStaleSubmodules,
  submoduleReached,
  syncSubmodules,
} from "./submodules.js";

/** Sparse pattern set for whole-repository mode: everything, minus noisy dirs. */
const WHOLE_REPO_SPARSE_PATTERNS = ["/*", ...BUILTIN_SPARSE_NEGATIONS];

export type FetchWarning =
  | { type: "no-matches"; name: string; includes: readonly string[] }
  | { type: "excludes-ignored"; name: string; filterMode: "includes" | "manifest" }
  | SubmoduleWarning;

export type FetchedTree = {
  kind: "git";
  name: string;
  cacheDir: string;
  commitSha: string;
  filterMode: FilterMode;
  filterSet: readonly string[];
  rules: readonly RuleEntry[];
  /**
   * The authoritative, sorted file list: always in whole-repository mode, and
   * in the other modes when submodule content had to be filtered in.
   */
  files?: readonly string[];
  /** Whole-repository mode: built-in excludes followed by the source's own. */
  excludes?: readonly string[];
  wholeRepoReason?: WholeRepoReason;
  skipped?: SkippedCounts;
  /** Submodules materialized for this source, at the commits the parent pins. */
  submodules?: readonly SubmoduleRef[];
  warnings: FetchWarning[];
};

export type FetchContext = {
  cacheDir: string;
  cacheExists: boolean;
  tokenForUrl: string | undefined;
};

type ManifestDiscovery =
  | { mode: "manifest"; patterns: string[]; rules: RuleEntry[] }
  | { mode: "no-manifest"; reason: "absent" | "invalid" };

export async function fetchGitSource(entry: GitSource, ctx: FetchContext): Promise<FetchedTree> {
  const includesDriven = hasExplicitIncludes(entry);
  await ensureCache(entry, ctx, !includesDriven);

  const probe = includesDriven ? undefined : await readManifestProbe(ctx.cacheDir);
  const resolution = resolveFilterMode(entry, probe);
  const warnings: FetchWarning[] = [];

  switch (resolution.mode) {
    case "invalid-manifest":
      throw manifestInvalidError(entry.name);
    case "whole-repository": {
      await setSparsePatterns(ctx.cacheDir, WHOLE_REPO_SPARSE_PATTERNS);
      const commitSha = await checkoutRef(ctx.cacheDir, entry.ref);
      const submodules = await resolveSubmodules(
        entry,
        ctx,
        { kind: "all", excludes: resolution.excludes },
        warnings,
      );
      const candidates = await listWorkingTreeFiles(ctx.cacheDir);
      const { files, skipped } = await filterWholeRepoFiles(
        ctx.cacheDir,
        candidates,
        resolution.excludes,
      );
      return {
        kind: "git",
        name: entry.name,
        cacheDir: ctx.cacheDir,
        commitSha,
        filterMode: "whole-repository",
        filterSet: ["**"],
        rules: [],
        files,
        excludes: resolution.excludes,
        wholeRepoReason: resolution.reason,
        skipped,
        ...(submodules.length > 0 ? { submodules } : {}),
        warnings,
      };
    }
    default: {
      if (entry.excludes && entry.excludes.length > 0) {
        warnings.push({ type: "excludes-ignored", name: entry.name, filterMode: resolution.mode });
      }
      await setSparsePatterns(ctx.cacheDir, resolution.patterns);
      const commitSha = await checkoutRef(ctx.cacheDir, entry.ref);
      const submodules = await resolveSubmodules(
        entry,
        ctx,
        { kind: "patterns", patterns: resolution.patterns },
        warnings,
      );
      const files =
        submodules.length > 0
          ? await filesWithSubmodules(ctx.cacheDir, resolution.patterns, submodules)
          : undefined;
      if (resolution.mode === "includes") {
        const count = (files ?? (await listWorkingTreeFiles(ctx.cacheDir))).length;
        if (count === 0) {
          warnings.push({ type: "no-matches", name: entry.name, includes: resolution.patterns });
        }
      }
      return {
        kind: "git",
        name: entry.name,
        cacheDir: ctx.cacheDir,
        commitSha,
        filterMode: resolution.mode,
        filterSet: resolution.patterns,
        rules: resolution.rules,
        ...(files ? { files } : {}),
        ...(submodules.length > 0 ? { submodules } : {}),
        warnings,
      };
    }
  }
}

/**
 * Materialize the submodules this source needs (architecture §6.7
 * Submodules). With `submodules: false` nothing is fetched, earlier nested
 * checkouts are removed, and a warning names any submodule the filter reached.
 */
async function resolveSubmodules(
  entry: GitSource,
  ctx: FetchContext,
  filter: SubmoduleFilter,
  warnings: FetchWarning[],
): Promise<SubmoduleRef[]> {
  if (entry.submodules === false) {
    await pruneStaleSubmodules(ctx.cacheDir, []);
    const links = await listGitlinks(ctx.cacheDir);
    const reached = links
      .map((l) => l.path)
      .filter((p) => filter.kind === "all" || submoduleReached(p, filter.patterns));
    if (reached.length > 0) {
      warnings.push({ type: "submodules-disabled", name: entry.name, paths: reached });
    }
    return [];
  }
  const result = await syncSubmodules({
    name: entry.name,
    root: ctx.cacheDir,
    sourceUrl: entry.url,
    token: ctx.tokenForUrl,
    filter,
  });
  warnings.push(...result.warnings);
  return result.submodules;
}

/**
 * Parent files exactly as the sparse checkout materialized them, plus the
 * submodule files the filter patterns select. Submodule checkouts may be
 * wider than the patterns (a full checkout when a pattern can't be re-rooted),
 * so they are filtered with manifest-resolution glob semantics.
 */
async function filesWithSubmodules(
  cacheDir: string,
  patterns: readonly string[],
  submodules: readonly SubmoduleRef[],
): Promise<string[]> {
  const subPaths = submodules.map((s) => s.path);
  const matches = compileFileMatcher(patterns);
  const all = await listWorkingTreeFiles(cacheDir);
  return all.filter((file) => !isUnderAny(file, subPaths) || matches(file));
}

/**
 * Clone (first run) or fetch + hard-reset (later runs) the source into its
 * cache. When the manifest will be consulted, make sure `maester.yaml` is in
 * the sparse set so discovery sees it regardless of the previous run's mode.
 */
async function ensureCache(
  entry: GitSource,
  ctx: FetchContext,
  needsManifest: boolean,
): Promise<void> {
  if (!ctx.cacheExists) {
    await shallowSparseClone({
      url: entry.url,
      destination: ctx.cacheDir,
      ref: entry.ref,
      ...(ctx.tokenForUrl ? { useTokenInUrl: ctx.tokenForUrl } : {}),
    });
    if (needsManifest) {
      // Materialize only the manifest first so the filter set is discovered
      // without paying for the full tree.
      await setSparsePatterns(ctx.cacheDir, [MAESTER_MANIFEST_FILENAME]);
      await checkoutRef(ctx.cacheDir, entry.ref);
    }
    return;
  }
  await fetchHead(ctx.cacheDir, entry.ref);
  if (needsManifest) await addSparsePatterns(ctx.cacheDir, [MAESTER_MANIFEST_FILENAME]);
}

function manifestInvalidError(name: string): MaesterError {
  return new MaesterError(
    "MAESTER_MANIFEST_INVALID",
    `source '${name}' publishes a maester.yaml that failed schema validation. Sync never treats a broken manifest as "publish everything" — fix the manifest in the source repo or declare an \`includes\` list on this source.`,
  );
}

/**
 * Legacy manifest discovery, still used by the status probe. Prefer
 * `readManifestProbe()` + `resolveFilterMode()` for new code.
 */
export async function discoverManifestFromCache(cacheDir: string): Promise<ManifestDiscovery> {
  const path = resolve(cacheDir, MAESTER_MANIFEST_FILENAME);
  if (!existsSync(path)) return { mode: "no-manifest", reason: "absent" };
  try {
    const raw = await readFile(path, "utf8");
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) return { mode: "no-manifest", reason: "invalid" };
    const parsed = MaesterConfigSchema.safeParse(doc.toJS({ maxAliasCount: -1 }));
    if (!parsed.success) return { mode: "no-manifest", reason: "invalid" };
    const rules: RuleEntry[] = parsed.data.documents.map((d) =>
      d.state === undefined ? { pattern: d.path } : { pattern: d.path, state: d.state },
    );
    const patterns = parsed.data.documents.map((d) => d.path);
    if (patterns.length === 0) return { mode: "no-manifest", reason: "invalid" };
    if (!patterns.includes(MAESTER_MANIFEST_FILENAME)) patterns.unshift(MAESTER_MANIFEST_FILENAME);
    return { mode: "manifest", patterns, rules };
  } catch {
    return { mode: "no-manifest", reason: "invalid" };
  }
}

/**
 * Root-relative paths of every regular file in a working tree, skipping
 * `.git`. Symbolic links committed to the source are skipped: linking to them
 * could point the citadel outside the fetched tree.
 */
export async function listWorkingTreeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) files.push(relative(root, fullPath).split("\\").join("/"));
    }
  }
  await walk(root);
  return files.sort();
}
