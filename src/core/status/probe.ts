import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Source } from "../../schemas/citadel.js";
import { CACHE_DIR_NAME } from "../config/paths.js";
import { MaesterError } from "../errors.js";
import {
  checkoutRef,
  listRemoteRef,
  setSparsePatterns,
  shallowSparseClone,
} from "../git/client.js";
import { discoverManifestFromCache } from "../sources/fetcher.js";

const SHA_RE = /^[0-9a-f]{40}$/;
const MAESTER_MANIFEST_FILENAME = "maester.yaml";
const STATUS_TEMP_PREFIX = ".status-";

export type ProbeContext = {
  repoRoot: string;
  tokenForUrl: string | undefined;
};

export type ManifestProbeResult = {
  filterSet: readonly string[];
};

export async function probeCommitSha(source: Source, ctx: ProbeContext): Promise<string> {
  if (source.ref && SHA_RE.test(source.ref)) {
    return source.ref;
  }
  return listRemoteRef({
    url: source.url,
    ref: source.ref,
    ...(ctx.tokenForUrl ? { useTokenInUrl: ctx.tokenForUrl } : {}),
  });
}

export async function probeManifest(
  source: Source,
  ctx: ProbeContext,
): Promise<ManifestProbeResult> {
  const tempRoot = resolve(ctx.repoRoot, CACHE_DIR_NAME);
  await mkdir(tempRoot, { recursive: true });
  const tempDir = await mkdtemp(resolve(tempRoot, STATUS_TEMP_PREFIX));
  try {
    await shallowSparseClone({
      url: source.url,
      destination: tempDir,
      ref: source.ref,
      ...(ctx.tokenForUrl ? { useTokenInUrl: ctx.tokenForUrl } : {}),
    });
    await setSparsePatterns(tempDir, [MAESTER_MANIFEST_FILENAME]);
    await checkoutRef(tempDir, source.ref);
    const discovery = await discoverManifestFromCache(tempDir);
    if (discovery.mode === "no-manifest") {
      throw manifestError(source.name, discovery.reason);
    }
    return { filterSet: discovery.patterns };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function manifestError(name: string, reason: "absent" | "invalid"): MaesterError {
  if (reason === "absent") {
    return new MaesterError(
      "MAESTER_MANIFEST_MISSING",
      `source '${name}' does not publish a maester.yaml manifest at the configured ref.`,
    );
  }
  return new MaesterError(
    "MAESTER_MANIFEST_INVALID",
    `source '${name}' publishes a maester.yaml that failed schema validation.`,
  );
}
