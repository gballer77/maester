import type { Command } from "commander";
import { loadCitadelConfig } from "../../core/config/loader.js";
import { detectRoles } from "../../core/config/paths.js";
import { MaesterError } from "../../core/errors.js";
import {
  type SkillInstallOutcome,
  type SkillInstallResult,
  type SkillKind,
  type SkillStatusResult,
  type SkillTargetId,
  listSkillTargets,
  runSkillInstall,
  runSkillStatus,
  runSkillUpgrade,
} from "../../core/skill/runner.js";
import { runtimePreread, runtimeStatusSummary } from "../../core/skill/runtime.js";
import { SKILL_VERSION } from "../../core/skill/version.js";
import { DEFAULT_BASE_DIR } from "../../schemas/citadel.js";
import { PromptCancelledError } from "../../ui/prompts.js";
import type { CliContext } from "../context.js";

const EXIT_OK = 0;
const EXIT_OUTDATED_OR_BEHIND = 1;
const EXIT_FAILED = 2;

const SUPPORTED_IDS: readonly SkillTargetId[] = ["claude-code", "codex", "cursor", "agents-md"];
const KIND_IDS: readonly SkillKind[] = ["grand-maester", "publisher"];
const KIND_LABELS: Record<SkillKind, string> = {
  "grand-maester": "Grand Maester",
  publisher: "Publisher",
};
const SKILL_OPTION = [
  "--skill <kind>",
  "Which skill: grand-maester (citadel reading) or publisher (defining maester.yaml).",
  parseKind,
] as const;

export function registerSkill(program: Command, getContext: () => CliContext): void {
  const group = program
    .command("skill")
    .description(
      "Install and manage maester's agent skills (Grand Maester, Publisher) in this repository.",
    );

  group
    .command("install")
    .description("Install an agent skill for one or more agent targets.")
    .option(
      "--target <id>",
      "Agent target id (repeatable). Skips the interactive picker.",
      collectTarget,
      [] as SkillTargetId[],
    )
    .option(...SKILL_OPTION)
    .action(async (options: { target: SkillTargetId[]; skill?: SkillKind }) => {
      process.exitCode = await runSkillInstallCommand(
        getContext(),
        options.target,
        "install",
        options.skill,
      );
    });

  group
    .command("upgrade")
    .description("Refresh every installed target's content to match the running maester version.")
    .option("--check", "Report which targets are outdated without writing.")
    .option(...SKILL_OPTION)
    .action(async (options: { check?: boolean; skill?: SkillKind }) => {
      process.exitCode = await runSkillUpgradeCommand(
        getContext(),
        options.check === true,
        options.skill,
      );
    });

  group
    .command("add-target <id>")
    .description("Install the skill for an additional agent target.")
    .option(...SKILL_OPTION)
    .action(async (id: string, options: { skill?: SkillKind }) => {
      if (!isSupportedId(id)) {
        const ctx = getContext();
        ctx.logger.error(`Unknown target '${id}'. Supported: ${SUPPORTED_IDS.join(", ")}`);
        process.exitCode = EXIT_FAILED;
        return;
      }
      process.exitCode = await runSkillInstallCommand(
        getContext(),
        [id],
        "add-target",
        options.skill,
      );
    });

  group
    .command("status")
    .description("Show which agent targets have a skill installed and whether each is up to date.")
    .option(...SKILL_OPTION)
    .action(async (options: { skill?: SkillKind }) => {
      process.exitCode = await runSkillStatusCommand(getContext(), options.skill);
    });

  const runtime = group
    .command("runtime")
    .description("Internal helpers invoked by installed agent hooks.");

  runtime
    .command("preread")
    .description(
      "Read a Claude Code PreToolUse hook envelope from stdin; emit a hook response. Always exits 0.",
    )
    .action(async () => {
      process.exitCode = await runRuntimePrereadCommand(getContext());
    });

  runtime
    .command("status-summary")
    .description("Print a one-line citadel-status summary. Exit ladder mirrors `maester status`.")
    .action(async () => {
      process.exitCode = await runRuntimeStatusSummaryCommand(getContext());
    });
}

export async function runSkillInstallCommand(
  ctx: CliContext,
  flagTargets: readonly SkillTargetId[],
  mode: "install" | "add-target",
  flagKind?: SkillKind,
): Promise<number> {
  let kind: SkillKind;
  try {
    kind = flagKind ?? (flagTargets.length > 0 ? "grand-maester" : await pickKind(ctx));
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      ctx.prompts.outro("Cancelled — no skill artifacts written.");
      return 130;
    }
    throw err;
  }
  // Only the Grand Maester needs a citadel; the Publisher installs anywhere (§6.19).
  const baseDir = kind === "grand-maester" ? await loadBaseDir(ctx) : DEFAULT_BASE_DIR;
  if (baseDir === null) return EXIT_FAILED;

  let targets: SkillTargetId[];
  if (flagTargets.length > 0) {
    targets = [...flagTargets];
  } else {
    try {
      targets = await pickTargetsInteractively(ctx, kind);
    } catch (err) {
      if (err instanceof PromptCancelledError) {
        ctx.prompts.outro("Cancelled — no skill artifacts written.");
        return 130;
      }
      throw err;
    }
    if (targets.length === 0) {
      ctx.logger.warning("No targets selected — nothing to install.");
      return EXIT_OK;
    }
  }

  let result: SkillInstallResult;
  try {
    result = await runSkillInstall(ctx.repoRoot.path, {
      kind,
      targets,
      mode,
      citadelBaseDir: baseDir,
    });
  } catch (err) {
    ctx.logger.error(err instanceof Error ? err.message : String(err));
    return EXIT_FAILED;
  }

  renderInstallResult(ctx, result, mode, kind);
  return result.counts.failed > 0 ? EXIT_FAILED : EXIT_OK;
}

export async function runSkillUpgradeCommand(
  ctx: CliContext,
  check: boolean,
  flagKind?: SkillKind,
): Promise<number> {
  let kinds: readonly SkillKind[] = flagKind ? [flagKind] : KIND_IDS;
  let baseDir = DEFAULT_BASE_DIR;
  if (kinds.includes("grand-maester")) {
    // The Grand Maester needs the citadel's base directory. Without a citadel,
    // an unflagged upgrade still refreshes the Publisher — unless a Grand
    // Maester is installed, which a broken citadel.yaml must not silently skip.
    const needsCitadel =
      flagKind === "grand-maester" || (await hasInstalled(ctx.repoRoot.path, "grand-maester"));
    const loaded = needsCitadel ? await loadBaseDir(ctx) : await loadBaseDirQuietly(ctx);
    if (loaded === null) {
      if (needsCitadel) return EXIT_FAILED;
      kinds = kinds.filter((k) => k !== "grand-maester");
    } else {
      baseDir = loaded;
    }
  }

  let result: SkillInstallResult;
  try {
    result = await runSkillUpgrade(ctx.repoRoot.path, { kinds, check, citadelBaseDir: baseDir });
  } catch (err) {
    ctx.logger.error(err instanceof Error ? err.message : String(err));
    return EXIT_FAILED;
  }

  if (result.outcomes.length === 0) {
    ctx.logger.info("No skill targets are installed. Run `maester skill install` first.");
    return check ? EXIT_OK : EXIT_OK;
  }

  for (const outcome of result.outcomes) {
    renderInstallOutcome(ctx, outcome);
  }
  ctx.logger.blank();
  const upgradedOrPending = result.counts.upgraded;
  if (result.counts.failed > 0) {
    ctx.logger.error(`${result.counts.failed} target(s) failed. See errors above.`);
    return EXIT_FAILED;
  }
  if (check && upgradedOrPending > 0) {
    ctx.logger.warning(
      `${upgradedOrPending} target(s) are outdated. Run \`maester skill upgrade\` to refresh.`,
    );
    return EXIT_OUTDATED_OR_BEHIND;
  }
  if (upgradedOrPending > 0) {
    ctx.logger.success(`Upgraded ${upgradedOrPending} target(s) to v${SKILL_VERSION}.`);
  } else {
    ctx.logger.success(`All ${result.outcomes.length} installed target(s) up to date.`);
  }
  return EXIT_OK;
}

export async function runSkillStatusCommand(
  ctx: CliContext,
  flagKind?: SkillKind,
): Promise<number> {
  const result = await runSkillStatus(ctx.repoRoot.path, flagKind ? { kinds: [flagKind] } : {});

  if (ctx.flags.json) {
    for (const outcome of result.outcomes) {
      process.stdout.write(`${JSON.stringify(outcome)}\n`);
    }
    process.stdout.write(`${JSON.stringify({ type: "summary", ...result.counts })}\n`);
  } else {
    renderStatusResult(ctx, result);
  }

  if (result.counts.upToDate + result.counts.outdated === 0) return EXIT_FAILED;
  if (result.counts.outdated > 0) return EXIT_OUTDATED_OR_BEHIND;
  return EXIT_OK;
}

export async function runRuntimePrereadCommand(ctx: CliContext): Promise<number> {
  const stdin = await readAllStdin();
  const out = await runtimePreread(stdin, { repoRoot: ctx.repoRoot.path });
  if (out.length > 0) process.stdout.write(out);
  return EXIT_OK;
}

export async function runRuntimeStatusSummaryCommand(ctx: CliContext): Promise<number> {
  const { summary, exitCode } = await runtimeStatusSummary({ repoRoot: ctx.repoRoot.path });
  process.stdout.write(`${summary}\n`);
  return exitCode;
}

/**
 * Interactive install without `--skill`: the Grand Maester needs a citadel,
 * the Publisher fits any repository. Ask only when both apply.
 */
async function pickKind(ctx: CliContext): Promise<SkillKind> {
  if (!detectRoles(ctx.repoRoot.path).hasCitadel) return "publisher";
  return ctx.prompts.select<SkillKind>({
    message: "Which skill should be installed?",
    options: [
      {
        value: "grand-maester",
        label: "Grand Maester",
        hint: "helps your agent read this citadel",
      },
      {
        value: "publisher",
        label: "Publisher",
        hint: "helps your agent define what this repo publishes (maester.yaml)",
      },
    ],
  });
}

async function pickTargetsInteractively(
  ctx: CliContext,
  kind: SkillKind,
): Promise<SkillTargetId[]> {
  ctx.prompts.intro(`Install the ${KIND_LABELS[kind]}`);
  const choices = listSkillTargets(kind).map((t) => ({
    value: t.id,
    label: t.label,
  }));
  const picked = await ctx.prompts.multiselect<SkillTargetId>({
    message: "Which agent(s) should the skill be installed for?",
    options: choices,
    initialValues: ["claude-code", "codex"] as SkillTargetId[],
    required: true,
  });
  return picked;
}

async function hasInstalled(repoRoot: string, kind: SkillKind): Promise<boolean> {
  for (const target of listSkillTargets(kind)) {
    if ((await target.readInstalledVersion(repoRoot)) !== undefined) return true;
  }
  return false;
}

async function loadBaseDirQuietly(ctx: CliContext): Promise<string | null> {
  try {
    const config = await loadCitadelConfig(ctx.repoRoot.path);
    return config.baseDir ?? DEFAULT_BASE_DIR;
  } catch {
    return null;
  }
}

async function loadBaseDir(ctx: CliContext): Promise<string | null> {
  try {
    const config = await loadCitadelConfig(ctx.repoRoot.path);
    return config.baseDir ?? DEFAULT_BASE_DIR;
  } catch (err) {
    const message =
      err instanceof MaesterError ? err.message : err instanceof Error ? err.message : String(err);
    ctx.logger.error(message);
    return null;
  }
}

function renderInstallResult(
  ctx: CliContext,
  result: SkillInstallResult,
  mode: "install" | "add-target",
  kind: SkillKind,
): void {
  if (ctx.flags.json) {
    for (const outcome of result.outcomes) {
      process.stdout.write(`${JSON.stringify(outcome)}\n`);
    }
    process.stdout.write(`${JSON.stringify({ type: "summary", ...result.counts })}\n`);
    return;
  }
  for (const outcome of result.outcomes) {
    renderInstallOutcome(ctx, outcome);
  }
  for (const reg of result.mcpRegistrations) {
    if (reg.action === "failed") {
      ctx.logger.error(`MCP refresh failed for ${reg.host}${reg.error ? `: ${reg.error}` : ""}`);
    } else if (reg.action !== "skipped") {
      ctx.logger.success(`MCP entry ${reg.action} → ${reg.filePath}`);
    }
  }
  ctx.logger.blank();
  const action = mode === "add-target" ? "Added" : "Installed";
  const total = result.counts.installed + result.counts.upgraded + result.counts.unchanged;
  if (result.counts.failed > 0) {
    ctx.logger.error(`${result.counts.failed} target(s) failed. See errors above.`);
    return;
  }
  ctx.logger.success(`${action} ${KIND_LABELS[kind]} for ${total} target(s) at v${SKILL_VERSION}.`);
}

/** Grand Maester rows keep their historical label; Publisher rows are prefixed. */
function rowLabel(outcome: { kind: SkillKind; label: string }): string {
  return outcome.kind === "grand-maester" ? outcome.label : `Publisher · ${outcome.label}`;
}

function renderInstallOutcome(ctx: CliContext, outcome: SkillInstallOutcome): void {
  const artifacts = outcome.artifactPaths.join(", ");
  const label = rowLabel(outcome);
  switch (outcome.action) {
    case "installed":
      ctx.logger.success(`${label}: installed → ${artifacts}`);
      break;
    case "upgraded":
      ctx.logger.success(`${label}: upgraded → ${artifacts}`);
      break;
    case "unchanged":
      ctx.logger.info(`${label}: already up to date (${artifacts})`);
      break;
    case "failed":
      ctx.logger.error(`${label}: failed${outcome.error ? ` — ${outcome.error}` : ""}`);
      break;
  }
}

function renderStatusResult(ctx: CliContext, result: SkillStatusResult): void {
  if (result.outcomes.length === 0) {
    ctx.logger.info("No skill targets registered.");
    return;
  }
  for (const outcome of result.outcomes) {
    switch (outcome.state) {
      case "up-to-date":
        ctx.logger.success(
          `${rowLabel(outcome)}: v${outcome.installedVersion ?? "?"} (up to date)`,
        );
        break;
      case "outdated":
        ctx.logger.warning(
          `${rowLabel(outcome)}: v${outcome.installedVersion ?? "?"} (latest v${outcome.currentVersion})`,
        );
        break;
      case "not-installed":
        ctx.logger.info(`${rowLabel(outcome)}: not installed`);
        break;
    }
  }
  ctx.logger.blank();
  const { upToDate, outdated, notInstalled } = result.counts;
  if (upToDate + outdated === 0) {
    ctx.logger.info("No skill targets installed. Run `maester skill install` to add one.");
    return;
  }
  if (outdated > 0) {
    ctx.logger.warning(`${outdated} target(s) outdated. Run \`maester skill upgrade\`.`);
    return;
  }
  ctx.logger.success(`${upToDate} target(s) up to date; ${notInstalled} available to install.`);
}

function parseKind(value: string): SkillKind {
  if (!(KIND_IDS as readonly string[]).includes(value)) {
    throw new Error(`Unknown skill '${value}'. Supported: ${KIND_IDS.join(", ")}`);
  }
  return value as SkillKind;
}

function collectTarget(value: string, prev: SkillTargetId[]): SkillTargetId[] {
  if (!isSupportedId(value)) {
    throw new Error(`Unknown target '${value}'. Supported: ${SUPPORTED_IDS.join(", ")}`);
  }
  return [...prev, value];
}

function isSupportedId(id: string): id is SkillTargetId {
  return (SUPPORTED_IDS as readonly string[]).includes(id);
}

async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
