import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, posix, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { globby } from "globby";
import picomatch from "picomatch";
import type { PublishedDocument } from "../../schemas/maester.js";
import { loadCitadelConfig, loadMaesterConfig } from "../config/loader.js";
import { defaultDestinationFor, maesterConfigPath } from "../config/paths.js";
import { BUILTIN_EXCLUDES, filterWholeRepoFiles } from "../sources/excludes.js";
import { handlerFor } from "../state/format.js";
import { matchSensitive } from "./sensitive.js";

const execFile = promisify(execFileCb);

/**
 * Read-only repository inventory for the Publisher (architecture §6.19,
 * Gap 79): candidate documents with their inline metadata and covering
 * entry, the vocabulary in use, a directory rollup, and likely-sensitive
 * files. Reports metadata only — never file contents.
 */
export type FileKind = "doc" | "data" | "other";

export type InventoryFile = {
  path: string;
  bytes: number;
  kind: FileKind;
  inline: { state?: string; category?: string; tags?: string[] };
  /** The first manifest entry whose path matches this file. */
  coveredBy: string | null;
};

export type InventoryReport = {
  manifest: "none" | "whole-repository" | "listed";
  vocabulary: { categories: Record<string, number>; tags: Record<string, number> };
  directories: { dir: string; docFiles: number; uncovered: number }[];
  files: InventoryFile[];
  sensitive: { path: string; reason: string }[];
  truncated: boolean;
};

export type InventoryOptions = {
  /** List every non-excluded file, not just documentation. */
  all?: boolean;
  /** Cap on `files`; the rollup and the sensitive list are always complete. */
  limit?: number;
};

export const DEFAULT_INVENTORY_LIMIT = 2000;

const DOC_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".markdown",
  ".rst",
  ".adoc",
  ".txt",
  ".html",
  ".htm",
]);
const DATA_EXTENSIONS = new Set([".yaml", ".yml", ".json", ".toml"]);

/** Same matcher options as manifest resolution and inline-metadata rules. */
const MATCHER_OPTIONS = { dot: false, nocase: false } as const;

export function fileKind(path: string): FileKind {
  const ext = extname(path).toLowerCase();
  if (DOC_EXTENSIONS.has(ext)) return "doc";
  if (DATA_EXTENSIONS.has(ext)) return "data";
  return "other";
}

export async function runInventory(
  repoRoot: string,
  options: InventoryOptions = {},
): Promise<InventoryReport> {
  const limit = options.limit ?? DEFAULT_INVENTORY_LIMIT;
  const documents = await readDocuments(repoRoot);
  const manifest =
    documents === undefined ? "none" : documents.length === 0 ? "whole-repository" : "listed";
  const excludes = [...BUILTIN_EXCLUDES, ...(await citadelDestinations(repoRoot))];

  // Sensitive files are reported only in `sensitive`, never as candidates.
  const candidates = (await listCandidates(repoRoot, excludes)).filter(
    (p) =>
      p !== "maester.yaml" &&
      matchSensitive(p) === undefined &&
      (options.all === true || fileKind(p) === "doc"),
  );
  const { files: kept } = await filterWholeRepoFiles(repoRoot, candidates, excludes);

  const rules = (documents ?? []).map((d) => ({
    path: d.path,
    match: picomatch(d.path, MATCHER_OPTIONS),
  }));
  const categories: Record<string, number> = {};
  const tags: Record<string, number> = {};
  const count = (bucket: Record<string, number>, key: string) => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };
  for (const doc of documents ?? []) {
    if (doc.category) count(categories, doc.category);
    for (const tag of doc.tags ?? []) count(tags, tag);
  }

  const files: InventoryFile[] = [];
  for (const path of kept) {
    const buf = await readFile(resolve(repoRoot, path));
    const inline = readInline(path, buf);
    if (inline.category) count(categories, inline.category);
    for (const tag of inline.tags ?? []) count(tags, tag);
    files.push({
      path,
      bytes: buf.length,
      kind: fileKind(path),
      inline,
      coveredBy: rules.find((r) => r.match(path))?.path ?? null,
    });
  }

  return {
    manifest,
    vocabulary: { categories: sortKeys(categories), tags: sortKeys(tags) },
    directories: rollup(files),
    files: files.slice(0, limit),
    sensitive: await findSensitive(repoRoot, excludes),
    truncated: files.length > limit,
  };
}

/** `undefined` when there is no manifest; an unreadable manifest is an error. */
async function readDocuments(repoRoot: string): Promise<PublishedDocument[] | undefined> {
  if (!existsSync(maesterConfigPath(repoRoot))) return undefined;
  return (await loadMaesterConfig(repoRoot)).documents ?? [];
}

/**
 * When this repository is also a citadel, its synced destinations hold other
 * repositories' content — never candidates for publishing from here.
 */
async function citadelDestinations(repoRoot: string): Promise<string[]> {
  try {
    const config = await loadCitadelConfig(repoRoot);
    return config.sources.map((s) => {
      const abs = s.destination
        ? resolve(repoRoot, s.destination)
        : defaultDestinationFor(repoRoot, s.name, config.baseDir);
      return `${relative(repoRoot, abs).split("\\").join("/")}/**`;
    });
  } catch {
    return [];
  }
}

/**
 * Tracked plus untracked-but-not-ignored files in a git work tree (honours
 * `.gitignore`); a filesystem walk elsewhere.
 */
async function listCandidates(repoRoot: string, excludes: readonly string[]): Promise<string[]> {
  try {
    const { stdout } = await execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 },
    );
    return [...new Set(stdout.split("\0").filter((p) => p.length > 0))].sort();
  } catch {
    return (
      await globby(["**"], {
        cwd: repoRoot,
        dot: true,
        onlyFiles: true,
        followSymbolicLinks: false,
        gitignore: false,
        ignore: [...excludes],
      })
    ).sort();
  }
}

function readInline(path: string, buf: Buffer): InventoryFile["inline"] {
  const handler = handlerFor(path);
  if (!handler) return {};
  const read = handler.read(buf);
  return {
    ...(read.state.kind === "valid" ? { state: read.state.value } : {}),
    ...(read.category.kind === "valid" ? { category: read.category.value } : {}),
    ...(read.tags.kind === "valid" ? { tags: read.tags.value } : {}),
  };
}

/**
 * Sensitive files anywhere outside the built-in excludes — including
 * gitignored ones, since a path source reads the filesystem, not git.
 */
async function findSensitive(
  repoRoot: string,
  excludes: readonly string[],
): Promise<InventoryReport["sensitive"]> {
  const all = await globby(["**"], {
    cwd: repoRoot,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    gitignore: false,
    ignore: [...excludes],
  });
  const out: InventoryReport["sensitive"] = [];
  for (const path of all.sort()) {
    const reason = matchSensitive(path);
    if (reason) out.push({ path, reason });
  }
  return out;
}

function rollup(files: readonly InventoryFile[]): InventoryReport["directories"] {
  const dirs = new Map<string, { docFiles: number; uncovered: number }>();
  for (const f of files) {
    if (f.kind !== "doc") continue;
    const dir = posix.dirname(f.path);
    const entry = dirs.get(dir) ?? { docFiles: 0, uncovered: 0 };
    entry.docFiles++;
    if (f.coveredBy === null) entry.uncovered++;
    dirs.set(dir, entry);
  }
  return [...dirs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, v]) => ({ dir, ...v }));
}

function sortKeys(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
