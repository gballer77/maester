import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { globby } from "globby";
import type { PublishedDocument } from "../../schemas/maester.js";
import { BUILTIN_EXCLUDES, filterWholeRepoFiles } from "../sources/excludes.js";
import { toRuleEntry } from "../sources/filter-mode.js";
import { resolveManifestFiles } from "../sources/local-source.js";
import {
  type FieldSourceOfTruth,
  type MetadataWarning,
  type SourceOfTruth,
  compileRules,
  resolveFileMetadata,
} from "../state/applier.js";
import { handlerFor } from "../state/format.js";

/**
 * `maester publish preview` (architecture §6.19, Gap 82): which files each
 * entry would publish, and the state / category / tags each file would carry
 * after inline precedence. Resolution uses the same functions as a path-source
 * sync (`resolveManifestFiles`, `resolveFileMetadata`). Never writes.
 */
export type PreviewFile = {
  path: string;
  /** `untagged`: a format inline metadata is never written into. */
  state: "canon" | "draft" | "untagged";
  stateSource: SourceOfTruth | "untagged";
  category?: string;
  categorySource: FieldSourceOfTruth | "untagged";
  tags?: string[];
  tagsSource: FieldSourceOfTruth | "untagged";
  /** Every entry matching this file, when more than one does. */
  multiMatch?: string[];
};

export type PreviewEntryFlag = "empty-entry" | "redundant";

export type PreviewEntry = {
  path: string;
  files: PreviewFile[];
  /**
   * `empty-entry`: matches no file. `redundant`: every file it matches is
   * already matched by an earlier entry — it publishes nothing extra.
   */
  flags: PreviewEntryFlag[];
};

export type PreviewReport =
  | {
      manifest: "listed";
      entries: PreviewEntry[];
      totalFiles: number;
      warnings: MetadataWarning[];
    }
  | {
      manifest: "none" | "whole-repository";
      directories: { dir: string; files: number }[];
      totalFiles: number;
    };

export async function runPreview(
  repoRoot: string,
  documents: readonly PublishedDocument[] | undefined,
): Promise<PreviewReport> {
  if (documents === undefined || documents.length === 0) {
    return wholeRepository(repoRoot, documents === undefined ? "none" : "whole-repository");
  }

  const compiled = compileRules(documents.map(toRuleEntry));
  const matches = new Map<string, string[]>();
  const perEntry: { path: string; files: string[] }[] = [];
  for (const doc of documents) {
    const files = await resolveManifestFiles(repoRoot, [doc.path]);
    perEntry.push({ path: doc.path, files });
    for (const file of files) matches.set(file, [...(matches.get(file) ?? []), doc.path]);
  }

  const resolved = new Map<string, PreviewFile>();
  const warnings: MetadataWarning[] = [];
  for (const [file, entries] of [...matches.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const preview = await previewFile(repoRoot, file, compiled, warnings);
    if (entries.length > 1) preview.multiMatch = entries;
    resolved.set(file, preview);
  }

  const seen = new Set<string>();
  const entries: PreviewEntry[] = perEntry.map(({ path, files }) => {
    const flags: PreviewEntryFlag[] = [];
    if (files.length === 0) flags.push("empty-entry");
    else if (files.every((f) => seen.has(f))) flags.push("redundant");
    for (const f of files) seen.add(f);
    return { path, files: files.map((f) => resolved.get(f) as PreviewFile), flags };
  });

  return { manifest: "listed", entries, totalFiles: matches.size, warnings };
}

async function previewFile(
  repoRoot: string,
  file: string,
  compiled: ReturnType<typeof compileRules>,
  warnings: MetadataWarning[],
): Promise<PreviewFile> {
  const handler = handlerFor(file);
  if (!handler) {
    return {
      path: file,
      state: "untagged",
      stateSource: "untagged",
      categorySource: "untagged",
      tagsSource: "untagged",
    };
  }
  const inline = handler.read(await readFile(resolve(repoRoot, file)));
  const meta = resolveFileMetadata(file, inline, compiled);
  warnings.push(...meta.warnings);
  return {
    path: file,
    state: meta.state,
    stateSource: meta.sourceOfTruth,
    ...(meta.category.value !== undefined ? { category: meta.category.value } : {}),
    categorySource: meta.category.source,
    ...(meta.tags.value !== undefined ? { tags: meta.tags.value } : {}),
    tagsSource: meta.tags.source,
  };
}

/** Whole-repository publishing: per-directory counts only (§6.13 filters). */
async function wholeRepository(
  repoRoot: string,
  manifest: "none" | "whole-repository",
): Promise<PreviewReport> {
  const candidates = await globby(["**"], {
    cwd: repoRoot,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    gitignore: false,
    ignore: [...BUILTIN_EXCLUDES],
  });
  const { files } = await filterWholeRepoFiles(repoRoot, candidates, BUILTIN_EXCLUDES);
  const dirs = new Map<string, number>();
  for (const f of files) {
    const dir = posix.dirname(f);
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  }
  return {
    manifest,
    directories: [...dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, n]) => ({ dir, files: n })),
    totalFiles: files.length,
  };
}
