import type { Command } from "commander";
import { loadCitadelConfig } from "../../core/config/loader.js";
import { MaesterError } from "../../core/errors.js";
import {
  type SkillInstallOutcome,
  type SkillInstallResult,
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

export function registerSkill(program: Command, getContext: () => CliContext): void {
  const group = program
    .command("skill")
    .description("Install and manage the Grand Maester agent skill in this repository.");

  group
    .command("install")
    .description("Install the Grand Maester skill for one or more agent targets.")
    .option(
      "--target <id>",
      "Agent target id (repeatable). Skips the interactive picker.",
      collectTarget,
      [] as SkillTargetId[],
    )
    .action(async (options: { target: SkillTargetId[] }) => {
      process.exitCode = await runSkillInstallCommand(getContext(), options.target, "install");
    });

  group
    .command("upgrade")
    .description("Refresh every installed target's content to match the running maester version.")
    .option("--check", "Report which targets are outdated without writing.")
    .action(async (options: { check?: boolean }) => {
      process.exitCode = await runSkillUpgradeCommand(getContext(), options.check === true);
    });

  group
    .command("add-target <id>")
    .description("Install the skill for an additional agent target.")
    .action(async (id: string) => {
      if (!isSupportedId(id)) {
        const ctx = getContext();
        ctx.logger.error(`Unknown target '${id}'. Supported: ${SUPPORTED_IDS.join(", ")}`);
        process.exitCode = EXIT_FAILED;
        return;
      }
      process.exitCode = await runSkillInstallCommand(getContext(), [id], "add-target");
    });

  group
    .command("status")
    .description(
      "Show which agent targets have the Grand Maester installed and whether each is up to date.",
    )
    .action(async () => {
      process.exitCode = await runSkillStatusCommand(getContext());
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
): Promise<number> {
  const baseDir = await loadBaseDir(ctx);
  if (baseDir === null) return EXIT_FAILED;

  let targets: SkillTargetId[];
  if (flagTargets.length > 0) {
    targets = [...flagTargets];
  } else {
    try {
      targets = await pickTargetsInteractively(ctx);
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
      targets,
      mode,
      citadelBaseDir: baseDir,
    });
  } catch (err) {
    ctx.logger.error(err instanceof Error ? err.message : String(err));
    return EXIT_FAILED;
  }

  renderInstallResult(ctx, result, mode);
  return result.counts.failed > 0 ? EXIT_FAILED : EXIT_OK;
}

export async function runSkillUpgradeCommand(ctx: CliContext, check: boolean): Promise<number> {
  const baseDir = await loadBaseDir(ctx);
  if (baseDir === null) return EXIT_FAILED;

  let result: SkillInstallResult;
  try {
    result = await runSkillUpgrade(ctx.repoRoot.path, { check, citadelBaseDir: baseDir });
  } catch (err) {
    ctx.logger.error(err instanceof Error ? err.message : String(err));
    return EXIT_FAILED;
  }

  if (result.outcomes.length === 0) {
    ctx.logger.info("No Grand Maester targets are installed. Run `maester skill install` first.");
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

export async function runSkillStatusCommand(ctx: CliContext): Promise<number> {
  const result = await runSkillStatus(ctx.repoRoot.path);

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

async function pickTargetsInteractively(ctx: CliContext): Promise<SkillTargetId[]> {
  ctx.prompts.intro("Install the Grand Maester");
  const choices = listSkillTargets().map((t) => ({
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
  ctx.logger.success(`${action} Grand Maester for ${total} target(s) at v${SKILL_VERSION}.`);
}

function renderInstallOutcome(ctx: CliContext, outcome: SkillInstallOutcome): void {
  const artifacts = outcome.artifactPaths.join(", ");
  switch (outcome.action) {
    case "installed":
      ctx.logger.success(`${outcome.label}: installed → ${artifacts}`);
      break;
    case "upgraded":
      ctx.logger.success(`${outcome.label}: upgraded → ${artifacts}`);
      break;
    case "unchanged":
      ctx.logger.info(`${outcome.label}: already up to date (${artifacts})`);
      break;
    case "failed":
      ctx.logger.error(`${outcome.label}: failed${outcome.error ? ` — ${outcome.error}` : ""}`);
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
        ctx.logger.success(`${outcome.label}: v${outcome.installedVersion ?? "?"} (up to date)`);
        break;
      case "outdated":
        ctx.logger.warning(
          `${outcome.label}: v${outcome.installedVersion ?? "?"} (latest v${outcome.currentVersion})`,
        );
        break;
      case "not-installed":
        ctx.logger.info(`${outcome.label}: not installed`);
        break;
    }
  }
  ctx.logger.blank();
  const { upToDate, outdated, notInstalled } = result.counts;
  if (upToDate + outdated === 0) {
    ctx.logger.info("No Grand Maester targets installed. Run `maester skill install` to add one.");
    return;
  }
  if (outdated > 0) {
    ctx.logger.warning(`${outdated} target(s) outdated. Run \`maester skill upgrade\`.`);
    return;
  }
  ctx.logger.success(`${upToDate} target(s) up to date; ${notInstalled} available to install.`);
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
