import { type RepoRoot, findRepoRoot } from "../core/repo/root.js";
import { type LogLevel, type Logger, createLogger } from "../ui/logger.js";
import { type Prompts, createPrompts } from "../ui/prompts.js";
import { type Theming, createTheming } from "../ui/theme/index.js";

export type GlobalFlags = {
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  color?: "auto" | "always" | "never";
  theme?: "dark" | "light";
  noWelcome?: boolean;
};

export type CliContext = {
  flags: GlobalFlags;
  theming: Theming;
  logger: Logger;
  prompts: Prompts;
  repoRoot: RepoRoot | undefined;
};

export function buildContext(flags: GlobalFlags, cwd: string = process.cwd()): CliContext {
  const theming = createTheming({
    forceColor: flags.color ?? "auto",
    ...(flags.theme !== undefined ? { themeOverride: flags.theme } : {}),
  });
  const level: LogLevel = flags.quiet ? "error" : flags.verbose ? "verbose" : "info";
  const logger = createLogger({ theming, level, json: flags.json ?? false });
  const prompts = createPrompts(theming);
  const repoRoot = findRepoRoot(cwd);
  return { flags, theming, logger, prompts, repoRoot };
}
