import type { Command } from "commander";
import { loadCitadelConfig } from "../../core/config/loader.js";
import { MaesterError } from "../../core/errors.js";
import { BUILTIN_EXCLUDES, WHOLE_REPO_MAX_FILE_BYTES } from "../../core/sources/excludes.js";
import type { StateApplyDetail, StateWarning } from "../../core/state/applier.js";
import {
  type SyncOutcome,
  type SyncResult,
  type SyncWarning,
  runSync,
} from "../../core/sync/runner.js";
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
    .addHelpText("after", wholeRepositoryHelp())
    .action(async (names: string[], options: { concurrency?: number }) => {
      const code = await runSyncCommand(getContext(), names, options.concurrency);
      process.exitCode = code;
    });
}

function wholeRepositoryHelp(): string {
  const maxKiB = WHOLE_REPO_MAX_FILE_BYTES / 1024;
  return [
    "",
    "Whole-repository sources:",
    "  A git source with no `includes`, pointing at a repo with no maester.yaml",
    "  (or one with an empty `documents` list), surfaces every file in the repo.",
    "  Those files are linked into the citadel from .maester/cache/<name>/ —",
    "  never copied — and the destination is added to .gitignore.",
    "",
    "  Always skipped:",
    ...BUILTIN_EXCLUDES.map((pattern) => `    ${pattern}`),
    `    files larger than ${maxKiB} KiB`,
    "    binary files (a NUL byte in the first 8000 bytes)",
    "",
    "  Narrow the set with `excludes` on the source, declare `includes`, or",
    "  publish a maester.yaml from the source repo.",
  ].join("\n");
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
      process.stdout.write(
        `${JSON.stringify(buildJsonOutcome(outcome, ctx.flags.verbose === true))}\n`,
      );
    }
  } else {
    renderHumanSummary(ctx, result);
  }
  return result.failed > 0 ? 1 : 0;
}

function buildJsonOutcome(outcome: SyncOutcome, verbose: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: outcome.name,
    kind: outcome.kind,
    status: outcome.status,
    destination: outcome.destination,
  };
  if (outcome.sourcePath !== undefined) base.sourcePath = outcome.sourcePath;
  if (outcome.ref !== undefined) base.ref = outcome.ref;
  if (outcome.commitSha !== undefined) base.commitSha = outcome.commitSha;
  if (outcome.mode !== undefined) base.mode = outcome.mode;
  if (outcome.filterMode !== undefined) base.filterMode = outcome.filterMode;
  if (outcome.wholeRepoReason !== undefined) base.wholeRepoReason = outcome.wholeRepoReason;
  if (outcome.fileCount !== undefined) base.fileCount = outcome.fileCount;
  if (outcome.skipped !== undefined) base.skipped = outcome.skipped;
  if (outcome.gitignoreEntry !== undefined) base.gitignoreEntry = outcome.gitignoreEntry;
  if (outcome.submodules !== undefined) base.submodules = outcome.submodules;
  if (outcome.warnings.length > 0) {
    base.warnings = outcome.warnings.map(serializeWarning);
  }
  if (outcome.stateBreakdown !== undefined) {
    base.stateBreakdown = outcome.stateBreakdown;
  }
  if (outcome.categoryBreakdown !== undefined) base.categoryBreakdown = outcome.categoryBreakdown;
  if (outcome.tagRollup !== undefined) base.tagRollup = outcome.tagRollup;
  if (verbose && outcome.stateDetails !== undefined) base.files = outcome.stateDetails;
  if (outcome.stateWarnings && outcome.stateWarnings.length > 0) {
    base.stateWarnings = outcome.stateWarnings;
  }
  if (outcome.error !== undefined) base.error = redactUrl(outcome.error);
  return base;
}

function serializeWarning(warning: SyncWarning): Record<string, unknown> {
  return { ...warning };
}

function renderHumanSummary(ctx: CliContext, result: SyncResult): void {
  for (const outcome of result.outcomes) {
    // Path sources have no commit; git sources always show one.
    const sha = outcome.kind === "path" ? "" : ` (${outcome.commitSha?.slice(0, 7) ?? "—"})`;
    const stateSuffix = formatStateBreakdownSuffix(outcome);
    const linked = modeLabel(outcome);
    switch (outcome.status) {
      case "added":
        ctx.logger.success(`${outcome.name}: added${sha}${linked}${stateSuffix}`);
        break;
      case "updated":
        ctx.logger.success(`${outcome.name}: updated${sha}${linked}${stateSuffix}`);
        break;
      case "unchanged":
        ctx.logger.info(`${outcome.name}: unchanged${linked}`);
        break;
      case "failed":
        ctx.logger.error(
          `${outcome.name}: failed — ${redactUrl(outcome.error ?? "unknown error")}`,
        );
        break;
    }
    if (outcome.status !== "failed") {
      renderWholeRepoLines(ctx, outcome);
      renderClassificationLine(ctx, outcome);
      renderSubmoduleLine(ctx, outcome);
    }
    for (const warning of outcome.warnings) {
      ctx.logger.warning(`  ${formatWarning(warning)}`);
    }
    for (const stateWarning of outcome.stateWarnings ?? []) {
      ctx.logger.warning(`  ${formatStateWarning(stateWarning)}`);
    }
    if (ctx.flags.verbose && outcome.stateDetails && outcome.stateDetails.length > 0) {
      for (const detail of outcome.stateDetails) {
        ctx.logger.verbose(`  ${formatDetail(detail)}`);
      }
    }
  }
  ctx.logger.blank();
  renderUnreachableSubmodules(ctx, result);
  if (result.failed > 0) {
    ctx.logger.error(`${result.failed} source(s) failed.`);
    return;
  }
  ctx.logger.success(`All ${result.outcomes.length} source(s) up to date.`);
}

/** `(linked)` for any linked source; `(copied)` for copy-mode path sources only. */
function modeLabel(outcome: SyncOutcome): string {
  if (outcome.mode === "link") return " (linked)";
  if (outcome.mode === "copy" && outcome.kind === "path") return " (copied)";
  return "";
}

function renderWholeRepoLines(ctx: CliContext, outcome: SyncOutcome): void {
  if (outcome.filterMode === "whole-repository") {
    const why =
      outcome.wholeRepoReason === "empty-manifest"
        ? "its maester.yaml lists no documents"
        : "it has no includes and no maester.yaml";
    const count = outcome.fileCount !== undefined ? ` (${outcome.fileCount} file(s))` : "";
    const scope = outcome.kind === "path" ? "whole directory" : "whole repository";
    const where = outcome.kind === "path" ? "in the directory" : "upstream";
    ctx.logger.info(`  ${scope}${count} — ${why}`);
    ctx.logger.info(
      `  narrow it with \`excludes\`, declare \`includes\`, or publish a maester.yaml ${where}`,
    );
  }
  if (outcome.gitignoreEntry) {
    ctx.logger.info(
      `  added ${outcome.gitignoreEntry} to .gitignore — linked content is machine-specific`,
    );
  }
  if (ctx.flags.verbose && outcome.skipped) {
    const { excluded, binary, oversize } = outcome.skipped;
    ctx.logger.verbose(
      `  skipped: ${excluded} excluded · ${binary} binary · ${oversize} over size cap`,
    );
  }
}

function renderSubmoduleLine(ctx: CliContext, outcome: SyncOutcome): void {
  const fetched = outcome.submodules?.length ?? 0;
  const skipped = outcome.warnings.filter((w) => w.type === "submodule-unreachable").length;
  if (fetched === 0 && skipped === 0) return;
  const skippedPart = skipped > 0 ? ` · ${skipped} skipped` : "";
  ctx.logger.info(`  submodules: ${fetched} fetched${skippedPart}`);
}

/** Repeated after the per-source lines so a skipped submodule isn't lost in scrollback. */
function renderUnreachableSubmodules(ctx: CliContext, result: SyncResult): void {
  const skipped = result.outcomes.flatMap((o) =>
    o.warnings.flatMap((w) => (w.type === "submodule-unreachable" ? [`${o.name}:${w.path}`] : [])),
  );
  if (skipped.length === 0) return;
  ctx.logger.warning(
    `${skipped.length} submodule(s) could not be fetched and were skipped: ${skipped.join(", ")}`,
  );
}

function formatWarning(warning: SyncWarning): string {
  switch (warning.type) {
    case "no-matches":
      return `no files matched includes — citadel-side filter set may need updating (${warning.includes.join(", ")})`;
    case "excludes-ignored":
      return `excludes ignored — they only apply to whole-repository sources (this source is ${warning.filterMode}-driven)`;
    case "destination-ignored":
      return warning.transition === "copy-to-link"
        ? `${warning.destination} switched from copied to linked and is now gitignored — previously committed copies stay in git history; run \`git rm -r --cached ${warning.destination}\` to stop tracking them`
        : `${warning.destination} switched from linked to copied but is still gitignored — remove its .gitignore entry to commit the copies`;
    case "submodule-unreachable":
      return `submodule ${warning.path} skipped — ${redactUrl(warning.reason)}`;
    case "submodules-disabled":
      return `submodules disabled for this source — skipped content under ${warning.paths.join(", ")}`;
    case "submodule-uninitialized":
      return `submodule ${warning.path} is not initialized — run \`git submodule update --init ${warning.path}\` in the source directory`;
  }
}

function formatStateBreakdownSuffix(outcome: SyncOutcome): string {
  const b = outcome.stateBreakdown;
  if (!b) return "";
  return `  canon: ${b.canon} · draft: ${b.draft} · untagged: ${b.untagged}`;
}

function formatStateWarning(warning: StateWarning): string {
  switch (warning.type) {
    case "bad-inline-state":
      return `${warning.file}: inline state '${warning.raw}' is not in {draft, canon} — treated as missing`;
    case "bad-inline-category":
      return `${warning.file}: inline category '${warning.raw}' is not a kebab-case slug — treated as missing`;
    case "bad-inline-tags":
      return `${warning.file}: inline tags '${warning.raw}' are not all kebab-case slugs — treated as missing`;
    case "disagreement":
      return `${warning.file}: inline ${warning.field} '${formatValue(warning.inline)}' overrides rule ${warning.field} '${formatValue(warning.rule)}'`;
  }
}

function formatValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * `categories: spec 12 · adr 4 · unclassified 3 · tags: 7 distinct`. Omitted
 * when nothing in the source carries a category or tag.
 */
function renderClassificationLine(ctx: CliContext, outcome: SyncOutcome): void {
  const categories = outcome.categoryBreakdown;
  const tags = outcome.tagRollup;
  if (!categories || !tags) return;
  const byCategory = Object.entries(categories.byCategory);
  const distinctTags = Object.keys(tags.byTag).length;
  if (byCategory.length === 0 && distinctTags === 0) return;
  const parts = byCategory
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([category, count]) => `${category} ${count}`);
  if (categories.unclassified > 0) parts.push(`unclassified ${categories.unclassified}`);
  const tagPart = distinctTags > 0 ? `tags: ${distinctTags} distinct` : "tags: none";
  ctx.logger.info(`  categories: ${parts.join(" · ")} · ${tagPart}`);
}

/** Verbose per-file line: each field with where its value came from. */
function formatDetail(detail: StateApplyDetail): string {
  if (detail.sourceOfTruth === "untagged") return `${detail.file} — untagged (unsupported format)`;
  const category = detail.category ?? "—";
  const tags = detail.tags?.join(",") ?? "—";
  return `${detail.file} — state=${detail.state} (${detail.sourceOfTruth}) · category=${category} (${detail.categorySource}) · tags=${tags} (${detail.tagsSource})`;
}
