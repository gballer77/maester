import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import type { MaesterSource } from "../../schemas/citadel.js";
import { MaesterConfigSchema } from "../../schemas/maester.js";
import { checkoutRef, fetchHead, setSparsePatterns, shallowSparseClone } from "../git/client.js";
import type { FetchContext, FetchWarning, FetchedTree, SourceFetcher } from "./fetcher.js";

const MAESTER_MANIFEST_FILENAME = "maester.yaml";

type ManifestDiscovery =
  | { mode: "manifest"; patterns: string[] }
  | { mode: "no-manifest"; reason: "absent" | "invalid" };

export function createMaesterFetcher(entry: MaesterSource): SourceFetcher {
  return {
    kind: "maester",
    fetch: (ctx) => fetchMaester(entry, ctx),
  };
}

export async function fetchMaester(entry: MaesterSource, ctx: FetchContext): Promise<FetchedTree> {
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
  const warnings: FetchWarning[] = [];
  let filterSet: readonly string[] | "all";

  if (discovery.mode === "manifest") {
    filterSet = discovery.patterns;
    await setSparsePatterns(ctx.cacheDir, discovery.patterns);
  } else {
    filterSet = "all";
    if (discovery.reason === "invalid") {
      warnings.push({ kind: "maester", type: "invalid-manifest", name: entry.name });
    }
    // "all" means full tree — disable sparse checkout.
    await setSparsePatterns(ctx.cacheDir, []);
  }
  const commitSha = await checkoutRef(ctx.cacheDir, entry.ref);

  return {
    kind: "maester",
    name: entry.name,
    cacheDir: ctx.cacheDir,
    commitSha,
    filterSet,
    warnings,
  };
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
    const patterns = parsed.data.documents.map((d) => d.path);
    if (patterns.length === 0) return { mode: "no-manifest", reason: "invalid" };
    if (!patterns.includes(MAESTER_MANIFEST_FILENAME)) patterns.unshift(MAESTER_MANIFEST_FILENAME);
    return { mode: "manifest", patterns };
  } catch {
    return { mode: "no-manifest", reason: "invalid" };
  }
}
