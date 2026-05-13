import { Command, type OptionValues } from "commander";
import { detectRoles } from "../core/config/paths.js";
import { MaesterError } from "../core/errors.js";
import { bannerForContext } from "../ui/components/banner.js";
import { PromptCancelledError } from "../ui/prompts.js";
import { createTheming } from "../ui/theme/index.js";
import { readColumns } from "../ui/width.js";
import { registerInit, runInit } from "./commands/init.js";
import { registerPublish, runPublish } from "./commands/publish.js";
import { registerSkill } from "./commands/skill.js";
import { registerStatus } from "./commands/status.js";
import { registerSync } from "./commands/sync.js";
import { type CliContext, type GlobalFlags, buildContext } from "./context.js";
import { showTopLevelMenu } from "./menu.js";

export async function run(argv: readonly string[] = process.argv): Promise<void> {
  const code = await runMain(argv);
  process.exitCode = code;
}

export async function runMain(argv: readonly string[] = process.argv): Promise<number> {
  maybeRenderHelpVersionBanner(argv);
  const program = buildProgram();
  try {
    await program.parseAsync(argv as string[]);
    return toExitCode(process.exitCode);
  } catch (err) {
    if (err instanceof PromptCancelledError) return 130;
    if (err instanceof MaesterError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return 1;
  }
}

function maybeRenderHelpVersionBanner(argv: readonly string[]): void {
  if (!process.stdout.isTTY) return;
  const tail = argv.slice(2);
  const wantsHelp = tail.includes("--help") || tail.includes("-h");
  const wantsVersion = tail.includes("--version") || tail.includes("-V");
  if (!wantsHelp && !wantsVersion) return;
  const theming = createTheming();
  const subtitle = wantsVersion ? "v0.1.0 · living specs" : "living specs · v0.1.0";
  const banner = bannerForContext(theming, readColumns(), subtitle);
  if (banner.length > 0) {
    process.stdout.write(`${banner}\n\n`);
  }
}

function toExitCode(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name("maester")
    .description("Aggregate documentation from many sources into one citadel.")
    .version("0.1.0", "-V, --version", "Print the maester version.")
    .option("--verbose", "Show verbose output")
    .option("--quiet", "Suppress all output except errors")
    .option("--json", "Emit machine-readable JSON output (one object per line)")
    .option("--color", "Force colored output (overrides auto-detection)")
    .option("--no-color", "Disable colored output (overrides auto-detection)")
    .option("--theme <theme>", "Theme override: 'dark' or 'light'")
    .option("--no-welcome", "Suppress the first-run welcome banner")
    .enablePositionalOptions(false)
    .allowExcessArguments(false);

  registerInit(program, () => buildContext(extractFlags(program.opts())));
  registerPublish(program, () => buildContext(extractFlags(program.opts())));
  registerSkill(program, () => buildContext(extractFlags(program.opts())));
  registerStatus(program, () => buildContext(extractFlags(program.opts())));
  registerSync(program, () => buildContext(extractFlags(program.opts())));

  program.action(async () => {
    const ctx = buildContext(extractFlags(program.opts()));
    const code = await runNoArgs(ctx);
    process.exitCode = code;
  });

  return program;
}

function extractFlags(opts: OptionValues): GlobalFlags {
  let color: "auto" | "always" | "never" = "auto";
  if (opts.color === true) color = "always";
  if (opts.color === false) color = "never";
  const theme =
    typeof opts.theme === "string" && (opts.theme === "light" || opts.theme === "dark")
      ? (opts.theme as "light" | "dark")
      : undefined;
  const envNoWelcome =
    typeof process.env.MAESTER_NO_WELCOME === "string" && process.env.MAESTER_NO_WELCOME.length > 0;
  return {
    verbose: opts.verbose === true,
    quiet: opts.quiet === true,
    json: opts.json === true,
    color,
    ...(theme ? { theme } : {}),
    noWelcome: opts.welcome === false || envNoWelcome,
  };
}

async function runNoArgs(ctx: CliContext): Promise<number> {
  if (!process.stdout.isTTY) {
    process.stdout.write("Run `maester --help` to see available commands.\n");
    return 0;
  }
  const roles = detectRoles(ctx.repoRoot.path);
  const showWelcome = !roles.hasCitadel && !roles.hasMaester && !ctx.flags.noWelcome;
  if (showWelcome) {
    const banner = bannerForContext(ctx.theming, readColumns(), "living specs · v0.1.0");
    if (banner.length > 0) {
      process.stdout.write(`${banner}\n\n`);
    }
    ctx.prompts.intro("Welcome to maester");
    ctx.prompts.log.message("This repository has no citadel or maester config yet.");
  }
  try {
    const choice = await showTopLevelMenu(ctx);
    switch (choice) {
      case "init":
        return runInit(ctx);
      case "publish":
        return runPublish(ctx);
      case "status":
        return runRoleSummary(ctx);
      case "exit":
        ctx.prompts.outro("Goodbye.");
        return 0;
    }
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      process.stdout.write("\n");
      return 130;
    }
    throw err;
  }
}

async function runRoleSummary(ctx: CliContext): Promise<number> {
  const roles = detectRoles(ctx.repoRoot.path);
  ctx.prompts.log.message(`Citadel: ${roles.hasCitadel ? "configured" : "not configured"}`);
  ctx.prompts.log.message(`Maester: ${roles.hasMaester ? "configured" : "not configured"}`);
  ctx.prompts.outro("");
  return 0;
}
