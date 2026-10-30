import { realpath, stat } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { MaesterError } from "../errors.js";

// Kept local (not imported from schemas/citadel.ts): the schema imports this
// module for its lexical checks, and a cycle would leave the regex undefined.
const PLACEHOLDER_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const PLACEHOLDER_RE = /\$\{([^}]*)\}/g;

export type ExpandContext = {
  repoRoot: string;
  env: NodeJS.ProcessEnv;
  homedir?: string;
};

export type ExpandedSourcePath = {
  /** Absolute path after `${VAR}`, `~`, and repo-relative resolution. */
  absolute: string;
  /** `realpath()` of `absolute`: used for overlap checks and recorded in the marker. */
  real: string;
};

export function hasPlaceholders(raw: string): boolean {
  return raw.includes("${");
}

/**
 * The first malformed `${…}` placeholder in a declared path, or undefined.
 * Catches an unterminated `${` and names that are not env-var shaped.
 */
export function malformedPlaceholder(raw: string): string | undefined {
  const withoutValid = raw.replace(PLACEHOLDER_RE, (match, name: string) =>
    PLACEHOLDER_NAME_RE.test(name) ? "" : match,
  );
  const bad = withoutValid.match(/\$\{[^}]*\}?/);
  return bad?.[0];
}

/**
 * True when `path` was declared relative to the citadel repo (no `~`, no
 * placeholder, not absolute). Such sources get relative link targets so
 * moving a parent folder holding both repos keeps links valid.
 */
export function isRelativeDeclaration(raw: string): boolean {
  return !isAbsolute(raw) && !raw.startsWith("~") && !hasPlaceholders(raw);
}

/** Expand placeholders and `~` and resolve against the repo, without touching disk. */
export function expandSourcePathLexically(
  sourceName: string,
  raw: string,
  ctx: ExpandContext,
): string {
  const withEnv = raw.replace(PLACEHOLDER_RE, (_match, name: string) => {
    const value = ctx.env[name];
    if (value === undefined || value === "") {
      throw new MaesterError(
        "SOURCE_PATH_ENV_UNSET",
        `source '${sourceName}' references \${${name}}, which is not set`,
      );
    }
    return value;
  });
  const home = ctx.homedir ?? osHomedir();
  const withHome =
    withEnv === "~" ? home : withEnv.startsWith("~/") ? resolve(home, withEnv.slice(2)) : withEnv;
  return resolve(ctx.repoRoot, withHome);
}

/**
 * Run-time expansion of a path source (architecture §6.14): `${VAR}` → `~` →
 * repo-relative → `realpath()`. Fails the source when a variable is unset or
 * the path is missing or not a directory.
 */
export async function expandSourcePath(
  sourceName: string,
  raw: string,
  ctx: ExpandContext,
): Promise<ExpandedSourcePath> {
  const absolute = expandSourcePathLexically(sourceName, raw, ctx);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    throw new MaesterError(
      "SOURCE_PATH_MISSING",
      `source '${sourceName}' path ${raw} does not exist (resolved to ${absolute})`,
    );
  }
  if (!(await stat(real)).isDirectory()) {
    throw new MaesterError(
      "SOURCE_PATH_MISSING",
      `source '${sourceName}' path ${raw} is not a directory (resolved to ${absolute})`,
    );
  }
  return { absolute, real };
}

export type OverlapTargets = {
  /** Absolute citadel base directory. */
  baseDir: string;
  /** Absolute destination of every configured source. */
  destinations: readonly { name: string; path: string; display: string }[];
  /** Repo-relative form of `baseDir`, for messages. */
  baseDirDisplay: string;
};

/**
 * Build overlap targets from the citadel repo's real path, so they compare
 * correctly against a `realpath()`ed source (e.g. macOS `/var` →
 * `/private/var`). Destinations need not exist yet.
 */
export async function realOverlapTargets(
  repoRoot: string,
  baseDir: string,
  sources: readonly { name: string; destination?: string | undefined }[],
): Promise<OverlapTargets> {
  const root = await realpath(repoRoot);
  return {
    baseDir: resolve(root, baseDir),
    baseDirDisplay: baseDir,
    destinations: sources.map((s) => {
      const display = s.destination ?? `${baseDir}/${s.name}`;
      return { name: s.name, path: resolve(root, display), display };
    }),
  };
}

function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const rel = relative(parent, child);
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/**
 * Gap 51: a path source must not read the citadel's own output, and sync
 * output must not land inside the source it reads. Returns the violation
 * message, or undefined when the source is safe.
 */
export function checkPathOverlap(
  sourceName: string,
  declared: string,
  sourcePath: string,
  targets: OverlapTargets,
): string | undefined {
  const prefix = `source '${sourceName}' path ${declared}`;
  if (isWithin(sourcePath, targets.baseDir)) {
    return `${prefix} lies inside the citadel base directory ${targets.baseDirDisplay}/`;
  }
  for (const dest of targets.destinations) {
    if (isWithin(sourcePath, dest.path)) {
      return `${prefix} overlaps destination ${dest.display}/ of source '${dest.name}'`;
    }
  }
  if (isWithin(targets.baseDir, sourcePath)) {
    return `${prefix} contains the citadel base directory ${targets.baseDirDisplay}/ — sync output would land inside the source it reads`;
  }
  for (const dest of targets.destinations) {
    if (isWithin(dest.path, sourcePath)) {
      return `${prefix} contains destination ${dest.display}/ of source '${dest.name}' — sync output would land inside the source it reads`;
    }
  }
  return undefined;
}
