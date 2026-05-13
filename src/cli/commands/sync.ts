import type { Command } from "commander";
import { loadCitadelConfig } from "../../core/config/loader.js";
import { MaesterError } from "../../core/errors.js";
import type { FetchWarning } from "../../core/sources/fetcher.js";
import type { StateWarning } from "../../core/state/applier.js";
import { type SyncOutcome, type SyncResult, runSync } from "../../core/sync/runner.js";
import type { CitadelConfig } from "../../schemas/citadel.js";
import { redactUrl } from "../../ui/logger.js";
import type { CliContext } from "../context.js";

export function registerSync(program: Command, getContext: () => CliContext): void {
  program
    .command("sync")
    .description("Fetch all configured sources into the local citadel.")
    .argument("[names...]", "Optional source names to scope the run")
    .option("--concurrency <n>", "Override the per-run source concurrency (default: 4)", (v) =>
      Number(v),
    )
    .action(async (names: string[], options: { concurrency?: number }) => {
      const code = await runSyncCommand(getContext(), names, options.concurrency);
      process.exitCode = code;
    });
}

export async function runSyncCommand(
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
    return 1;
  }

  if (!ctx.flags.json) {
    const totalConfigured = config.sources.length;
    ctx.logger.info(`Syncing ${scope.length > 0 ? scope.length : totalConfigured} source(s)…`);
  }

  const result = await runSync(config, {
    repoRoot: ctx.repoRoot.path,
    ...(scope.length > 0 ? { scope } : {}),
    ...(concurrency !== undefined && Number.isFinite(concurrency) ? { concurrency } : {}),
    onProgress: (event) => {
      if (!ctx.flags.json) return;
      process.stdout.write(`${JSON.stringify({ event: event.type, ...event })}\n`);
    },
  });

  if (ctx.flags.json) {
    for (const outcome of result.outcomes) {
      process.stdout.write(`${JSON.stringify(buildJsonOutcome(outcome))}\n`);
    }
  } else {
    renderHumanSummary(ctx, result);
  }
  return result.failed > 0 ? 1 : 0;
}

function buildJsonOutcome(outcome: SyncOutcome): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: outcome.name,
    status: outcome.status,
    destination: outcome.destination,
  };
  if (outcome.ref !== undefined) base.ref = outcome.ref;
  if (outcome.commitSha !== undefined) base.commitSha = outcome.commitSha;
  if (outcome.warnings.length > 0) {
    base.warnings = outcome.warnings.map(serializeWarning);
  }
  if (outcome.stateBreakdown !== undefined) {
    base.stateBreakdown = outcome.stateBreakdown;
  }
  if (outcome.stateWarnings && outcome.stateWarnings.length > 0) {
    base.stateWarnings = outcome.stateWarnings;
  }
  if (outcome.error !== undefined) base.error = redactUrl(outcome.error);
  return base;
}

function serializeWarning(warning: FetchWarning): Record<string, unknown> {
  return {
    type: warning.type,
    name: warning.name,
    includes: warning.includes,
  };
}

function renderHumanSummary(ctx: CliContext, result: SyncResult): void {
  for (const outcome of result.outcomes) {
    const shortSha = outcome.commitSha?.slice(0, 7) ?? "—";
    const stateSuffix = formatStateBreakdownSuffix(outcome);
    switch (outcome.status) {
      case "added":
        ctx.logger.success(`${outcome.name}: added (${shortSha})${stateSuffix}`);
        break;
      case "updated":
        ctx.logger.success(`${outcome.name}: updated (${shortSha})${stateSuffix}`);
        break;
      case "unchanged":
        ctx.logger.info(`${outcome.name}: unchanged`);
        break;
      case "failed":
        ctx.logger.error(
          `${outcome.name}: failed — ${redactUrl(outcome.error ?? "unknown error")}`,
        );
        break;
    }
    for (const warning of outcome.warnings) {
      ctx.logger.warning(`  ${formatWarning(warning)}`);
    }
    for (const stateWarning of outcome.stateWarnings ?? []) {
      ctx.logger.warning(`  ${formatStateWarning(stateWarning)}`);
    }
    if (ctx.flags.verbose && outcome.stateDetails && outcome.stateDetails.length > 0) {
      for (const detail of outcome.stateDetails) {
        ctx.logger.verbose(`  ${detail.file} — state=${detail.state} (${detail.sourceOfTruth})`);
      }
    }
  }
  ctx.logger.blank();
  if (result.failed > 0) {
    ctx.logger.error(`${result.failed} source(s) failed.`);
    return;
  }
  ctx.logger.success(`All ${result.outcomes.length} source(s) up to date.`);
}

function formatWarning(warning: FetchWarning): string {
  return `no files matched includes — citadel-side filter set may need updating (${warning.includes.join(", ")})`;
}

function formatStateBreakdownSuffix(outcome: SyncOutcome): string {
  const b = outcome.stateBreakdown;
  if (!b) return "";
  return `  canon: ${b.canon} · draft: ${b.draft} · untagged: ${b.untagged}`;
}

function formatStateWarning(warning: StateWarning): string {
  if (warning.type === "bad-inline-state") {
    return `${warning.file}: inline state '${warning.raw}' is not in {draft, canon} — treated as missing`;
  }
  return `${warning.file}: inline state '${warning.inline}' overrides rule state '${warning.rule}'`;
}
