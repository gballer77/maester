import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_BASE_DIR } from "../../schemas/citadel.js";
import { loadCitadelConfig } from "../config/loader.js";
import { runStatus } from "../status/runner.js";
import type { StatusResult } from "../status/runner.js";

const CACHE_RELATIVE_PATH = ".maester/.skill-cache.json";
const DEFAULT_TTL_SECONDS = 300;

export type PrereadOptions = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Override for tests: substitute the status runner. */
  runStatus?: typeof runStatus;
};

/**
 * Implements `maester skill runtime preread`. Reads a Claude Code PreToolUse
 * hook envelope from stdin (passed in as a string), and returns the JSON
 * response body the hook script should write to stdout.
 *
 * Returns "" (empty body, no-op) when:
 * - the envelope cannot be parsed,
 * - no file path can be extracted,
 * - no citadel config exists in the repo,
 * - the target path is outside the citadel base directory.
 */
export async function runtimePreread(stdinJson: string, opts: PrereadOptions): Promise<string> {
  const envelope = parseEnvelopeSafe(stdinJson);
  if (!envelope) return "";

  const filePath = extractTargetPath(envelope, opts.repoRoot);
  if (!filePath) return "";

  let baseDir: string;
  let configForStatus: Awaited<ReturnType<typeof loadCitadelConfig>>;
  try {
    configForStatus = await loadCitadelConfig(opts.repoRoot);
    baseDir = configForStatus.baseDir ?? DEFAULT_BASE_DIR;
  } catch {
    return "";
  }

  if (!isUnderBaseDir(filePath, opts.repoRoot, baseDir)) return "";

  const ttlSeconds = readTtlSeconds(opts.env);
  const now = opts.now ?? (() => Date.now());
  const cached = await readCache(opts.repoRoot);
  let verdict: CachedVerdict;
  if (cached && now() - cached.ts < ttlSeconds * 1000) {
    verdict = cached;
  } else {
    const runner = opts.runStatus ?? runStatus;
    try {
      const result = await runner(configForStatus, { repoRoot: opts.repoRoot });
      verdict = {
        ts: now(),
        verdict: classifyVerdict(result),
        summary: summarize(result),
      };
      await writeCache(opts.repoRoot, verdict);
    } catch (err) {
      verdict = {
        ts: now(),
        verdict: "failed",
        summary: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (verdict.verdict === "up-to-date") return "";
  return buildHookResponse(verdict);
}

export type StatusSummaryOptions = {
  repoRoot: string;
  runStatus?: typeof runStatus;
};

/**
 * Implements `maester skill runtime status-summary`. Loads the citadel config,
 * runs status, and returns a one-line human-readable summary plus an exit
 * code that mirrors the `maester status` ladder.
 */
export async function runtimeStatusSummary(
  opts: StatusSummaryOptions,
): Promise<{ summary: string; exitCode: 0 | 1 | 2 }> {
  let config: Awaited<ReturnType<typeof loadCitadelConfig>>;
  try {
    config = await loadCitadelConfig(opts.repoRoot);
  } catch (err) {
    return {
      summary: err instanceof Error ? err.message : String(err),
      exitCode: 2,
    };
  }
  const runner = opts.runStatus ?? runStatus;
  try {
    const result = await runner(config, { repoRoot: opts.repoRoot });
    const summary = summarize(result);
    let exitCode: 0 | 1 | 2 = 0;
    if (result.counts.failed > 0) exitCode = 2;
    else if (result.counts.behind > 0) exitCode = 1;
    return { summary, exitCode };
  } catch (err) {
    return {
      summary: err instanceof Error ? err.message : String(err),
      exitCode: 2,
    };
  }
}

type CachedVerdict = {
  ts: number;
  verdict: "up-to-date" | "behind" | "failed";
  summary: string;
};

type HookEnvelope = {
  cwd?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    path?: string;
    pattern?: string;
  };
};

function parseEnvelopeSafe(raw: string): HookEnvelope | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed as HookEnvelope;
  } catch {
    return undefined;
  }
}

function extractTargetPath(envelope: HookEnvelope, repoRoot: string): string | undefined {
  const input = envelope.tool_input;
  if (!input) return undefined;
  const raw = input.file_path ?? input.path ?? input.pattern;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const cwd = typeof envelope.cwd === "string" ? envelope.cwd : repoRoot;
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

function isUnderBaseDir(targetPath: string, repoRoot: string, baseDir: string): boolean {
  const base = path.resolve(repoRoot, baseDir);
  const rel = path.relative(base, targetPath);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function readTtlSeconds(env: NodeJS.ProcessEnv | undefined): number {
  const raw = (env ?? process.env).MAESTER_SKILL_STATUS_TTL;
  if (!raw) return DEFAULT_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TTL_SECONDS;
  return parsed;
}

async function readCache(repoRoot: string): Promise<CachedVerdict | undefined> {
  try {
    const raw = await fs.readFile(path.join(repoRoot, CACHE_RELATIVE_PATH), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const candidate = parsed as Partial<CachedVerdict>;
    if (
      typeof candidate.ts !== "number" ||
      (candidate.verdict !== "up-to-date" &&
        candidate.verdict !== "behind" &&
        candidate.verdict !== "failed") ||
      typeof candidate.summary !== "string"
    ) {
      return undefined;
    }
    return {
      ts: candidate.ts,
      verdict: candidate.verdict,
      summary: candidate.summary,
    };
  } catch {
    return undefined;
  }
}

async function writeCache(repoRoot: string, verdict: CachedVerdict): Promise<void> {
  const finalPath = path.join(repoRoot, CACHE_RELATIVE_PATH);
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  const tempPath = `${finalPath}.tmp-${Math.floor(Math.random() * 1e9)}`;
  await fs.writeFile(tempPath, `${JSON.stringify(verdict)}\n`, "utf8");
  await fs.rename(tempPath, finalPath);
}

function classifyVerdict(result: StatusResult): CachedVerdict["verdict"] {
  if (result.counts.failed > 0) return "failed";
  if (result.counts.behind > 0) return "behind";
  return "up-to-date";
}

function summarize(result: StatusResult): string {
  const { upToDate, behind, failed } = result.counts;
  const total = upToDate + behind + failed;
  if (total === 0) return "no sources configured";
  if (behind === 0 && failed === 0) return `all ${upToDate} sources up to date`;
  const parts: string[] = [];
  if (behind > 0) parts.push(`${behind} behind`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (upToDate > 0) parts.push(`${upToDate} up to date`);
  return parts.join(", ");
}

function buildHookResponse(verdict: CachedVerdict): string {
  const detail =
    verdict.verdict === "failed"
      ? `Citadel status check failed: ${verdict.summary}. Proceed with the read and flag that cited content may be stale; do not retry sync in a loop.`
      : `Citadel is behind (${verdict.summary}). Auto-sync policy: run \`npx baller-maester sync\`, then \`rm -f .maester/.skill-cache.json\` to invalidate this hook's cache, then proceed with the read. Do not prompt the user — sync is read-only against the configured remotes.`;
  const response = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: detail,
    },
  };
  return `${JSON.stringify(response)}\n`;
}
