import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { GitSource } from "../../schemas/citadel.js";
import { CACHE_DIR_NAME } from "../config/paths.js";
import { MaesterError } from "../errors.js";
import {
  checkoutRef,
  listRemoteRef,
  setSparsePatterns,
  shallowSparseClone,
} from "../git/client.js";
import {
  type FilterMode,
  MAESTER_MANIFEST_FILENAME,
  readManifestProbe,
  resolveFilterMode,
} from "../sources/filter-mode.js";

const SHA_RE = /^[0-9a-f]{40}$/;
const STATUS_TEMP_PREFIX = ".status-";

export type ProbeContext = {
  repoRoot: string;
  tokenForUrl: string | undefined;
};

export type ManifestProbeResult = {
  filterMode: Exclude<FilterMode, "includes">;
  filterSet: readonly string[];
  /** Whole-repository mode only: the effective exclude list sync would apply. */
  excludes?: readonly string[];
};

export async function probeCommitSha(source: GitSource, ctx: ProbeContext): Promise<string> {
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
  source: GitSource,
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
    const resolution = resolveFilterMode(
      { excludes: source.excludes },
      await readManifestProbe(tempDir),
    );
    switch (resolution.mode) {
      case "invalid-manifest":
        throw new MaesterError(
          "MAESTER_MANIFEST_INVALID",
          `source '${source.name}' publishes a maester.yaml that failed schema validation.`,
        );
      case "whole-repository":
        // Must mirror what sync records for whole-repository markers.
        return { filterMode: resolution.mode, filterSet: ["**"], excludes: resolution.excludes };
      default:
        return { filterMode: "manifest", filterSet: resolution.patterns };
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
