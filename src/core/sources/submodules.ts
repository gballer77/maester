import { execFile as execFileCb } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import picomatch from "picomatch";
import { detectGitCapabilities, injectToken } from "../git/client.js";
import { BUILTIN_SPARSE_NEGATIONS } from "./excludes.js";

const execFile = promisify(execFileCb);

const GITLINK_MODE = "160000";
/** Guards against pathological nesting; real repositories stay far below this. */
export const MAX_SUBMODULE_DEPTH = 8;
/** Nested checkouts this tool created, recorded inside the parent cache's `.git`. */
const RECORD_FILENAME = "maester-submodules.json";
const FULL_SPARSE_PATTERNS = ["/*", ...BUILTIN_SPARSE_NEGATIONS];
/** Same matcher options as manifest resolution (`resolveManifestFiles`). */
const MATCHER_OPTIONS = { dot: false } as const;

export type Gitlink = { path: string; sha: string };

/** A submodule materialized for a source: parent-relative path + pinned commit. */
export type SubmoduleRef = { path: string; commitSha: string };

export type SubmoduleWarning =
  | { type: "submodule-unreachable"; name: string; path: string; reason: string }
  | { type: "submodules-disabled"; name: string; paths: string[] }
  | { type: "submodule-uninitialized"; name: string; path: string };

/** Which submodules a source needs: those its patterns reach, or all of them minus excludes. */
export type SubmoduleFilter =
  | { kind: "patterns"; patterns: readonly string[] }
  | { kind: "all"; excludes: readonly string[] };

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFile("git", [...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Every gitlink (submodule pointer) in a commit's tree. Trees are present even in a blob-less clone. */
export async function listGitlinks(workDir: string, treeish = "HEAD"): Promise<Gitlink[]> {
  let stdout: string;
  try {
    stdout = await git(workDir, ["ls-tree", "-r", "-z", treeish]);
  } catch {
    return [];
  }
  const links: Gitlink[] = [];
  for (const record of stdout.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, , sha] = record.slice(0, tab).split(" ");
    if (mode === GITLINK_MODE && sha) links.push({ path: record.slice(tab + 1), sha });
  }
  return links;
}

/** `.gitmodules` from a commit (`--blob`) or the working tree (`-f`), as path → url. */
export async function readGitmodules(
  workDir: string,
  from: { treeish: string } | { file: string } = { treeish: "HEAD" },
): Promise<Map<string, string>> {
  const source = "treeish" in from ? ["--blob", `${from.treeish}:.gitmodules`] : ["-f", from.file];
  let stdout: string;
  try {
    stdout = await git(workDir, [
      "config",
      ...source,
      "--get-regexp",
      "^submodule\\..*\\.(path|url)$",
    ]);
  } catch {
    // Exit 1 (no matches) or a missing .gitmodules: no submodules declared.
    return new Map();
  }
  const byName = new Map<string, { path?: string; url?: string }>();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^submodule\.(.+)\.(path|url) (.*)$/);
    if (!match?.[1] || !match[2]) continue;
    const entry = byName.get(match[1]) ?? {};
    entry[match[2] as "path" | "url"] = match[3] ?? "";
    byName.set(match[1], entry);
  }
  const out = new Map<string, string>();
  for (const { path, url } of byName.values()) {
    if (path && url) out.set(path.replace(/\/+$/, ""), url);
  }
  return out;
}

/**
 * Resolve a `.gitmodules` url against the superproject's url, as git does:
 * `./x` and `../x` are relative to the parent url treated as a directory.
 */
export function resolveSubmoduleUrl(parentUrl: string, url: string): string {
  if (!url.startsWith("./") && !url.startsWith("../")) return url;
  const { prefix, path } = splitUrl(parentUrl.replace(/\/+$/, ""));
  const parts = path.split("/");
  const floor = path.startsWith("/") ? 1 : 0;
  for (const segment of url.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > floor) parts.pop();
    } else parts.push(segment);
  }
  return prefix + parts.join("/");
}

function splitUrl(url: string): { prefix: string; path: string } {
  const scheme = url.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i);
  if (scheme) return { prefix: scheme[1] ?? "", path: scheme[2] ?? "" };
  const scp = url.match(/^([^/:]+@[^/:]+:|[^/:]+:(?!\/))(.*)$/);
  if (scp) return { prefix: scp[1] ?? "", path: scp[2] ?? "" };
  return { prefix: "", path: url };
}

export function hostOf(url: string): string | undefined {
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url))
      return new URL(url).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
  return url.match(/^(?:[^/@:]+@)?([^/:]+):(?!\/)/)?.[1]?.toLowerCase();
}

/**
 * The parent's token, only for an https submodule on the same host as the
 * source. Credentials are never sent to another host.
 */
export function credentialForSubmodule(
  sourceUrl: string,
  submoduleUrl: string,
  token: string | undefined,
): string | undefined {
  if (!token || !submoduleUrl.startsWith("https://")) return undefined;
  const host = hostOf(sourceUrl);
  return host !== undefined && host === hostOf(submoduleUrl) ? token : undefined;
}

type Consumed = { kind: "none" } | { kind: "anywhere" } | { kind: "rest"; rest: string[] };

/**
 * Walk a glob's segments down a directory path. `rest` is what the pattern
 * still has to match below the directory; `anywhere` means a `**` was crossed,
 * so the remainder cannot be re-rooted segment by segment.
 */
function consumePath(pattern: string, dirPath: string): Consumed {
  const patternSegs = pattern.replace(/^\/+/, "").split("/");
  const dirSegs = dirPath.split("/");
  for (let i = 0; i < dirSegs.length; i++) {
    const seg = patternSegs[i];
    if (seg === undefined) return { kind: "none" };
    if (seg === "**") return { kind: "anywhere" };
    if (!picomatch.isMatch(dirSegs[i] ?? "", seg, MATCHER_OPTIONS)) return { kind: "none" };
  }
  const rest = patternSegs.slice(dirSegs.length);
  if (rest.length > 0) return { kind: "rest", rest };
  // The pattern names the directory itself: a literal directory expands to
  // everything under it, a glob only matches files and so never a directory.
  return picomatch.scan(pattern).isGlob ? { kind: "none" } : { kind: "anywhere" };
}

/** Could any of these patterns select a file inside the directory at `dirPath`? */
export function submoduleReached(dirPath: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => !p.startsWith("!") && consumePath(p, dirPath).kind !== "none");
}

/** Sparse-checkout patterns for inside the submodule at `dirPath`; full checkout when a pattern can't be re-rooted. */
export function rerootPatterns(dirPath: string, patterns: readonly string[]): string[] {
  const out = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue;
    const consumed = consumePath(pattern, dirPath);
    if (consumed.kind === "anywhere") return [...FULL_SPARSE_PATTERNS];
    if (consumed.kind === "rest") out.add(`/${consumed.rest.join("/")}`);
  }
  return [...out];
}

/**
 * Glob matcher with the same semantics as manifest resolution: a literal
 * directory pattern also selects everything below it (globby's expansion).
 */
export function compileFileMatcher(patterns: readonly string[]): (file: string) => boolean {
  const expanded = patterns.flatMap((p) =>
    picomatch.scan(p).isGlob ? [p] : [p, `${p.replace(/\/+$/, "")}/**`],
  );
  return picomatch(expanded, MATCHER_OPTIONS);
}

export function isUnderAny(file: string, dirs: readonly string[]): string | undefined {
  return dirs.find((dir) => file.startsWith(`${dir}/`));
}

type MaterializeInput = {
  dir: string;
  url: string;
  sha: string;
  sparsePatterns: readonly string[];
  token: string | undefined;
};

/**
 * Check out one submodule at its pinned commit as a nested repository at its
 * gitlink path. The parent's sparse checkout and hard reset leave a populated
 * nested repository alone, so it survives later parent updates.
 */
export async function materializeSubmodule(input: MaterializeInput): Promise<void> {
  const fetchUrl = input.token ? injectToken(input.url, input.token) : input.url;
  if (existsSync(resolve(input.dir, ".git"))) {
    await git(input.dir, ["remote", "set-url", "origin", fetchUrl]);
  } else {
    await mkdir(input.dir, { recursive: true });
    await git(input.dir, ["init", "--quiet"]);
    await git(input.dir, ["remote", "add", "origin", fetchUrl]);
  }
  if ((await currentHead(input.dir)) !== input.sha) await fetchCommit(input.dir, input.sha);
  await git(input.dir, ["sparse-checkout", "set", "--no-cone", "--", ...input.sparsePatterns]);
  await git(input.dir, [
    "-c",
    "advice.detachedHead=false",
    "checkout",
    "--quiet",
    "--detach",
    input.sha,
  ]);
}

async function currentHead(dir: string): Promise<string | undefined> {
  try {
    return (await git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"])).trim();
  } catch {
    return undefined;
  }
}

/**
 * Shallow fetch of the pinned commit; when the server refuses a want by SHA,
 * fall back to fetching the submodule's history and finding it there.
 */
async function fetchCommit(dir: string, sha: string): Promise<void> {
  const caps = await detectGitCapabilities();
  const filter = caps.supportsPartialClone ? ["--filter=blob:none"] : [];
  try {
    await git(dir, ["fetch", "--quiet", "--depth=1", ...filter, "origin", sha]);
  } catch {
    await git(dir, ["fetch", "--quiet", ...filter, "origin"]);
  }
}

export type SyncSubmodulesInput = {
  name: string;
  /** The parent repository's working tree (the source cache). */
  root: string;
  sourceUrl: string;
  token: string | undefined;
  filter: SubmoduleFilter;
};

export type SyncSubmodulesResult = {
  submodules: SubmoduleRef[];
  warnings: SubmoduleWarning[];
};

/**
 * Materialize every submodule the filter needs, recursively, then remove
 * nested checkouts from earlier runs that are no longer needed. A submodule
 * that can't be fetched becomes a warning; the rest of the source continues.
 */
export async function syncSubmodules(input: SyncSubmodulesInput): Promise<SyncSubmodulesResult> {
  const result: SyncSubmodulesResult = { submodules: [], warnings: [] };
  const wanted = wantedPredicate(input.filter);
  await walk(input, wanted, result, {
    dir: input.root,
    prefix: "",
    url: input.sourceUrl,
    depth: 0,
  });
  await pruneStaleSubmodules(
    input.root,
    result.submodules.map((s) => s.path),
  );
  return result;
}

type WalkLevel = { dir: string; prefix: string; url: string; depth: number };

async function walk(
  input: SyncSubmodulesInput,
  wanted: (path: string) => boolean,
  result: SyncSubmodulesResult,
  level: WalkLevel,
): Promise<void> {
  const links = await listGitlinks(level.dir);
  if (links.length === 0) return;
  const urls = await readGitmodules(level.dir);
  for (const link of links) {
    const path = level.prefix ? `${level.prefix}/${link.path}` : link.path;
    if (!wanted(path)) continue;
    const unreachable = (reason: string) =>
      result.warnings.push({ type: "submodule-unreachable", name: input.name, path, reason });
    if (level.depth >= MAX_SUBMODULE_DEPTH) {
      unreachable(`nested more than ${MAX_SUBMODULE_DEPTH} levels deep`);
      continue;
    }
    const rawUrl = urls.get(link.path);
    if (!rawUrl) {
      unreachable("no url declared in .gitmodules");
      continue;
    }
    const url = resolveSubmoduleUrl(level.url, rawUrl);
    const dir = resolve(level.dir, link.path);
    try {
      await materializeSubmodule({
        dir,
        url,
        sha: link.sha,
        sparsePatterns: sparsePatternsFor(input.filter, path),
        token: credentialForSubmodule(input.sourceUrl, url, input.token),
      });
    } catch (err) {
      unreachable(gitErrorSummary(err));
      continue;
    }
    result.submodules.push({ path, commitSha: link.sha });
    await walk(input, wanted, result, { dir, prefix: path, url, depth: level.depth + 1 });
  }
}

function wantedPredicate(filter: SubmoduleFilter): (path: string) => boolean {
  if (filter.kind === "patterns") return (path) => submoduleReached(path, filter.patterns);
  const excluded = picomatch([...filter.excludes], { dot: true });
  // A submodule under an excluded directory (vendor/, node_modules/, ...) is skipped whole.
  return (path) => !excluded(`${path}/_`);
}

function sparsePatternsFor(filter: SubmoduleFilter, path: string): string[] {
  return filter.kind === "all" ? [...FULL_SPARSE_PATTERNS] : rerootPatterns(path, filter.patterns);
}

/** Remove nested checkouts recorded by earlier runs that this run didn't keep. */
export async function pruneStaleSubmodules(root: string, keep: readonly string[]): Promise<void> {
  const recordPath = resolve(root, ".git", RECORD_FILENAME);
  const previous = await readRecord(recordPath);
  const kept = new Set(keep);
  // Deepest first, so a nested checkout goes before the one containing it.
  const stale = previous.filter((p) => !kept.has(p)).sort((a, b) => b.length - a.length);
  for (const path of stale) {
    const dir = resolve(root, path);
    if (!isNestedRepo(dir)) continue;
    await rm(dir, { recursive: true, force: true });
    // The path may now hold tracked parent content (a submodule replaced by files).
    await git(root, ["checkout", "HEAD", "--", path]).catch(() => undefined);
  }
  if (keep.length === 0 && previous.length === 0) return;
  await writeFile(recordPath, `${JSON.stringify([...keep])}\n`, "utf8");
}

async function readRecord(path: string): Promise<string[]> {
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function isNestedRepo(dir: string): boolean {
  try {
    return statSync(resolve(dir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

/** First meaningful line of a git error, with any embedded credentials removed. */
function gitErrorSummary(err: unknown): string {
  const raw =
    err instanceof Error ? ((err as { stderr?: string }).stderr ?? err.message) : String(err);
  const line =
    raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("fatal:") || l.startsWith("error:")) ??
    raw.split("\n")[0] ??
    "fetch failed";
  return line.replace(/\/\/[^/@\s]+@/g, "//").replace(/^(fatal|error):\s*/, "");
}

export type LocalSubmodule = { path: string; initialized: boolean };

/**
 * Submodules declared in a local working tree, recursing into initialized
 * ones. Read-only: an uninitialized submodule is reported, never initialized.
 */
export async function localSubmodules(
  root: string,
  prefix = "",
  depth = 0,
): Promise<LocalSubmodule[]> {
  if (depth > MAX_SUBMODULE_DEPTH) return [];
  const gitmodules = resolve(root, ".gitmodules");
  if (!existsSync(gitmodules)) return [];
  const declared = await readGitmodules(root, { file: gitmodules });
  const out: LocalSubmodule[] = [];
  for (const path of [...declared.keys()].sort()) {
    const full = prefix ? `${prefix}/${path}` : path;
    const dir = resolve(root, path);
    const initialized = existsSync(resolve(dir, ".git"));
    out.push({ path: full, initialized });
    if (initialized) out.push(...(await localSubmodules(dir, full, depth + 1)));
  }
  return out;
}
