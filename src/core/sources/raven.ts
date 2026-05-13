import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { RavenSource } from "../../schemas/citadel.js";
import { checkoutRef, fetchHead, setSparsePatterns, shallowSparseClone } from "../git/client.js";
import type { FetchContext, FetchWarning, FetchedTree, SourceFetcher } from "./fetcher.js";

export function createRavenFetcher(entry: RavenSource): SourceFetcher {
  return {
    kind: "raven",
    fetch: (ctx) => fetchRaven(entry, ctx),
  };
}

export async function fetchRaven(entry: RavenSource, ctx: FetchContext): Promise<FetchedTree> {
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

  // Ravens skip the maester-side manifest-discovery step entirely — the citadel
  // owns the filter set via `includes`, which is already in hand and validated
  // as non-empty by the schema.
  await setSparsePatterns(ctx.cacheDir, entry.includes);
  const commitSha = await checkoutRef(ctx.cacheDir, entry.ref);

  const matchedFileCount = await countMaterializedFiles(ctx.cacheDir);
  const warnings: FetchWarning[] = [];
  if (matchedFileCount === 0) {
    warnings.push({
      kind: "raven",
      type: "no-matches",
      name: entry.name,
      includes: entry.includes,
    });
  }

  return {
    kind: "raven",
    name: entry.name,
    cacheDir: ctx.cacheDir,
    commitSha,
    filterSet: entry.includes,
    warnings,
  };
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
