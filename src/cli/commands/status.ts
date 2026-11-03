import type { Command } from "commander";
import { loadCitadelConfig } from "../../core/config/loader.js";
import { MaesterError } from "../../core/errors.js";
import {
  type BehindReason,
  type StatusOutcome,
  type StatusResult,
  runStatus,
} from "../../core/status/runner.js";
import type { CitadelConfig } from "../../schemas/citadel.js";
import { redactUrl } from "../../ui/logger.js";
import type { CliContext } from "../context.js";

const EXIT_OK = 0;
const EXIT_BEHIND = 1;
const EXIT_FAILED = 2;

export function registerStatus(program: Command, getContext: () => CliContext): void {
  program
    .command("status")
    .description(
      "Check whether configured sources are up to date with their remotes. Exit codes: 0 (all up to date), 1 (any behind), 2 (any failed or config error).",
    )
    .argument("[names...]", "Optional source names to scope the run")
    .option("--concurrency <n>", "Override the per-run source concurrency (default: 4)", (v) =>
      Number(v),
    )
    .action(async (names: string[], options: { concurrency?: number }) => {
      const code = await runStatusCommand(getContext(), names, options.concurrency);
      process.exitCode = code;
    });
}

export async function runStatusCommand(
  ctx: CliContext,
  scope: readonly string[],
  concurrency?: number,
): Promise<number> {
  let config: CitadelConfig;
  try {
    config = await loadCitadelConfig(ctx.repoRoot.path);
  } catch (err) {
    const message =
      err instanceof MaesterError ? err.message : err instanceof Error ? err.message : String(err);
    ctx.logger.error(message);
    return EXIT_FAILED;
  }

  let result: StatusResult;
  try {
    result = await runStatus(config, {
      repoRoot: ctx.repoRoot.path,
      ...(scope.length > 0 ? { scope } : {}),
      ...(concurrency !== undefined && Number.isFinite(concurrency) ? { concurrency } : {}),
    });
  } catch (err) {
    const message =
      err instanceof MaesterError ? err.message : err instanceof Error ? err.message : String(err);
    ctx.logger.error(message);
    return EXIT_FAILED;
  }

  if (ctx.flags.json) {
    for (const outcome of result.outcomes) {
      process.stdout.write(`${JSON.stringify(buildJsonOutcome(outcome))}\n`);
    }
    process.stdout.write(`${JSON.stringify({ type: "summary", ...result.counts })}\n`);
  } else {
    renderHumanSummary(ctx, result);
  }

  if (result.counts.failed > 0) return EXIT_FAILED;
  if (result.counts.behind > 0) return EXIT_BEHIND;
  return EXIT_OK;
}

function buildJsonOutcome(outcome: StatusOutcome): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: outcome.name,
    verdict: outcome.verdict,
    kind: outcome.kind,
  };
  if (outcome.mode !== undefined) base.mode = outcome.mode;
  if (outcome.filterMode !== undefined) base.filterMode = outcome.filterMode;
  if (outcome.sourcePath !== undefined) base.sourcePath = outcome.sourcePath;
  if (outcome.submodules !== undefined) base.submodules = outcome.submodules;
  if (outcome.verdict === "up-to-date") {
    if (outcome.commitSha !== undefined) base.commitSha = outcome.commitSha;
    return base;
  }
  if (outcome.verdict === "behind") {
    base.reasons = outcome.reasons;
    if (outcome.commitSha !== undefined) base.commitSha = outcome.commitSha;
    if (outcome.resolvedSha !== undefined) base.resolvedSha = outcome.resolvedSha;
    return base;
  }
  if (outcome.reason !== undefined) base.reason = outcome.reason;
  return { ...base, error: redactUrl(outcome.error) };
}

function renderHumanSummary(ctx: CliContext, result: StatusResult): void {
  if (result.outcomes.length === 0) {
    ctx.logger.info("No sources configured.");
    return;
  }
  for (const outcome of result.outcomes) {
    const mode = formatMode(outcome);
    switch (outcome.verdict) {
      case "up-to-date":
        ctx.logger.success(
          `${outcome.name}: up to date${outcome.commitSha ? ` (${shortSha(outcome.commitSha)})` : ""}${mode}`,
        );
        break;
      case "behind":
        ctx.logger.warning(`${outcome.name}: behind — ${formatReasons(outcome)}${mode}`);
        break;
      case "failed":
        ctx.logger.error(`${outcome.name}: failed — ${redactUrl(outcome.error)}${mode}`);
        break;
    }
    for (const sub of outcome.submodules ?? []) {
      ctx.logger.info(`  submodule ${sub.path} @ ${shortSha(sub.commitSha)}`);
    }
  }
  ctx.logger.blank();
  renderSummaryLine(ctx, result);
}

function renderSummaryLine(ctx: CliContext, result: StatusResult): void {
  const { upToDate, behind, failed } = result.counts;
  if (failed > 0) {
    ctx.logger.error(
      `${failed} source(s) failed, ${behind} behind, ${upToDate} up to date. See errors above.`,
    );
    return;
  }
  if (behind > 0) {
    ctx.logger.warning(
      `${behind} of ${result.outcomes.length} source(s) behind. Run \`maester sync\` to refresh.`,
    );
    return;
  }
  ctx.logger.success(`All ${result.outcomes.length} source(s) up to date.`);
}

function formatReasons(outcome: Extract<StatusOutcome, { verdict: "behind" }>): string {
  const parts: string[] = [];
  for (const reason of outcome.reasons) {
    parts.push(formatReason(reason, outcome));
  }
  return parts.join("; ");
}

function formatReason(
  reason: BehindReason,
  outcome: Extract<StatusOutcome, { verdict: "behind" }>,
): string {
  switch (reason) {
    case "never-synced":
      return "never synced (run `maester sync` to populate this destination)";
    case "remote-ref-advanced": {
      const recorded = outcome.commitSha ? shortSha(outcome.commitSha) : "—";
      const remote = outcome.resolvedSha ? shortSha(outcome.resolvedSha) : "—";
      return `remote ref advanced (recorded ${recorded}, remote ${remote})`;
    }
    case "cache-missing":
      return "local cache missing — linked files no longer resolve";
    case "local-changed":
      return "local source changed since the last sync";
    case "manifest-changed":
      return "publish surface changed (remote maester.yaml, filter mode, or excludes)";
  }
}

/** The mode recorded by the last sync; empty for never-synced sources. */
function formatMode(outcome: StatusOutcome): string {
  if (!outcome.filterMode) return "";
  // Git sources only show the mode when linked; path sources always do.
  const linked =
    outcome.mode === "link"
      ? ", linked"
      : outcome.kind === "path" && outcome.mode === "copy"
        ? ", copied"
        : "";
  return `  [${outcome.filterMode}${linked}]`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
