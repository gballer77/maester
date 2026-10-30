import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { type Source, normalizeIncludeEntry } from "../../schemas/citadel.js";
import { MaesterConfigSchema } from "../../schemas/maester.js";
import type { RuleEntry } from "../state/schema.js";
import { effectiveExcludes } from "./excludes.js";

export const MAESTER_MANIFEST_FILENAME = "maester.yaml";

export type FilterMode = "includes" | "manifest" | "whole-repository";
export type WholeRepoReason = "no-manifest" | "empty-manifest";

/** What a source's root `maester.yaml` says, independent of how it was read. */
export type ManifestProbe =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "empty" }
  | { kind: "valid"; patterns: string[]; rules: RuleEntry[] };

export type FilterResolution =
  | { mode: "includes"; patterns: string[]; rules: RuleEntry[] }
  | { mode: "manifest"; patterns: string[]; rules: RuleEntry[] }
  | { mode: "whole-repository"; reason: WholeRepoReason; excludes: string[] }
  | { mode: "invalid-manifest" };

export function hasExplicitIncludes(entry: Pick<Source, "includes">): boolean {
  return !!entry.includes && entry.includes.length > 0;
}

/**
 * The single chokepoint for filter-mode precedence: includes → manifest →
 * whole-repository. Callers pass `probe: undefined` when the source declares
 * `includes`, so the manifest is never read in includes-driven mode.
 */
export function resolveFilterMode(
  entry: Pick<Source, "includes" | "excludes">,
  probe: ManifestProbe | undefined,
): FilterResolution {
  if (hasExplicitIncludes(entry)) {
    const normalized = (entry.includes ?? []).map(normalizeIncludeEntry);
    return {
      mode: "includes",
      patterns: normalized.map((e) => e.path),
      rules: normalized.map((e) =>
        e.state === undefined ? { pattern: e.path } : { pattern: e.path, state: e.state },
      ),
    };
  }
  switch (probe?.kind) {
    case "valid":
      return { mode: "manifest", patterns: probe.patterns, rules: probe.rules };
    case "invalid":
      return { mode: "invalid-manifest" };
    case "empty":
      return wholeRepository("empty-manifest", entry);
    default:
      return wholeRepository("no-manifest", entry);
  }
}

function wholeRepository(
  reason: WholeRepoReason,
  entry: Pick<Source, "excludes">,
): FilterResolution {
  return { mode: "whole-repository", reason, excludes: effectiveExcludes(entry.excludes) };
}

/** Read and classify `<dir>/maester.yaml`. Never throws. */
export async function readManifestProbe(dir: string): Promise<ManifestProbe> {
  const path = resolve(dir, MAESTER_MANIFEST_FILENAME);
  if (!existsSync(path)) return { kind: "absent" };
  try {
    const doc = parseDocument(await readFile(path, "utf8"));
    if (doc.errors.length > 0) return { kind: "invalid" };
    const parsed = MaesterConfigSchema.safeParse(doc.toJS({ maxAliasCount: -1 }));
    if (!parsed.success) return { kind: "invalid" };
    if (parsed.data.documents.length === 0) return { kind: "empty" };
    const rules: RuleEntry[] = parsed.data.documents.map((d) =>
      d.state === undefined ? { pattern: d.path } : { pattern: d.path, state: d.state },
    );
    const patterns = parsed.data.documents.map((d) => d.path);
    if (!patterns.includes(MAESTER_MANIFEST_FILENAME)) patterns.unshift(MAESTER_MANIFEST_FILENAME);
    return { kind: "valid", patterns, rules };
  } catch {
    return { kind: "invalid" };
  }
}
