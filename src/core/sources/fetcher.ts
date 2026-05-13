import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { type Source, normalizeIncludeEntry } from "../../schemas/citadel.js";
import { MaesterConfigSchema } from "../../schemas/maester.js";
import { MaesterError } from "../errors.js";
import { checkoutRef, fetchHead, setSparsePatterns, shallowSparseClone } from "../git/client.js";
import type { RuleEntry } from "../state/schema.js";

const MAESTER_MANIFEST_FILENAME = "maester.yaml";

export type FetchWarning = {
  type: "no-matches";
  name: string;
  includes: readonly string[];
};

export type FetchedTree = {
  name: string;
  cacheDir: string;
  commitSha: string;
  filterSet: readonly string[];
  rules: readonly RuleEntry[];
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

export async function fetchSource(entry: Source, ctx: FetchContext): Promise<FetchedTree> {
  if (entry.includes && entry.includes.length > 0) {
    const normalized = entry.includes.map(normalizeIncludeEntry);
    return fetchWithExplicitIncludes(entry, ctx, normalized);
  }
  return fetchWithRemoteManifest(entry, ctx);
}

async function fetchWithRemoteManifest(entry: Source, ctx: FetchContext): Promise<FetchedTree> {
  if (!ctx.cacheExists) {
    await shallowSparseClone({
      url: entry.url,
      destination: ctx.cacheDir,
      ref: entry.ref,
      ...(ctx.tokenForUrl ? { useTokenInUrl: ctx.tokenForUrl } : {}),
    });
    // Materialize only the manifest first so we can discover the filter set
    // without paying the cost of the full tree.
    await setSparsePatterns(ctx.cacheDir, [MAESTER_MANIFEST_FILENAME]);
    await checkoutRef(ctx.cacheDir, entry.ref);
  } else {
    await fetchHead(ctx.cacheDir, entry.ref);
  }

  const discovery = await discoverManifestFromCache(ctx.cacheDir);
  if (discovery.mode === "no-manifest") {
    throw manifestError(entry.name, discovery.reason);
  }

  await setSparsePatterns(ctx.cacheDir, discovery.patterns);
  const commitSha = await checkoutRef(ctx.cacheDir, entry.ref);

  return {
    name: entry.name,
    cacheDir: ctx.cacheDir,
    commitSha,
    filterSet: discovery.patterns,
    rules: discovery.rules,
    warnings: [],
  };
}

async function fetchWithExplicitIncludes(
  entry: Source,
  ctx: FetchContext,
  normalized: readonly { path: string; state?: import("../state/schema.js").State }[],
): Promise<FetchedTree> {
  if (!ctx.cacheExists) {
    await shallowSparseClone({
      url: entry.url,
      destination: ctx.cacheDir,
      ref: entry.ref,
      ...(ctx.tokenForUrl ? { useTokenInUrl: ctx.tokenForUrl } : {}),
    });
  } else {
    await fetchHead(ctx.cacheDir, entry.ref);
  }

  // Explicit includes bypass remote manifest discovery — the citadel owns the
  // filter set directly. Validated as non-empty by the schema.
  const patterns = normalized.map((entry) => entry.path);
  await setSparsePatterns(ctx.cacheDir, patterns);
  const commitSha = await checkoutRef(ctx.cacheDir, entry.ref);

  const matchedFileCount = await countMaterializedFiles(ctx.cacheDir);
  const warnings: FetchWarning[] = [];
  if (matchedFileCount === 0) {
    warnings.push({ type: "no-matches", name: entry.name, includes: patterns });
  }

  const rules: RuleEntry[] = normalized.map((entry) =>
    entry.state === undefined
      ? { pattern: entry.path }
      : { pattern: entry.path, state: entry.state },
  );

  return {
    name: entry.name,
    cacheDir: ctx.cacheDir,
    commitSha,
    filterSet: patterns,
    rules,
    warnings,
  };
}

function manifestError(name: string, reason: "absent" | "invalid"): MaesterError {
  if (reason === "absent") {
    return new MaesterError(
      "MAESTER_MANIFEST_MISSING",
      `source '${name}' does not publish a maester.yaml manifest at the configured ref. Sync will not fall back to the full tree — either add a maester.yaml to the source repo or declare an \`includes\` list on this source.`,
    );
  }
  return new MaesterError(
    "MAESTER_MANIFEST_INVALID",
    `source '${name}' publishes a maester.yaml that failed schema validation. Sync will not fall back to the full tree — fix the manifest in the source repo or declare an \`includes\` list on this source.`,
  );
}

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

async function countMaterializedFiles(cacheDir: string): Promise<number> {
  let count = 0;
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await readdir(dir, {
        withFileTypes: true,
        encoding: "utf8",
      })) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        count++;
      }
    }
  }
  await walk(cacheDir);
  return count;
}
