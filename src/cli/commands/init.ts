import type { Command } from "commander";
import { detectRoles } from "../../core/config/paths.js";
import { detectDestinationCollisions, finalizeCitadel } from "../../core/init/finalize.js";
import {
  validateDestination,
  validateEnvVarName,
  validateGitUrl,
  validateSourceName,
} from "../../core/init/validators.js";
import type { AuthRef, MaesterSource } from "../../schemas/citadel.js";
import { PromptCancelledError } from "../../ui/prompts.js";
import type { CliContext } from "../context.js";

export function registerInit(program: Command, getContext: () => CliContext): void {
  program
    .command("init")
    .description("Initialize this repository as a citadel (walkthrough).")
    .action(async () => {
      await runInit(getContext());
    });
}

export async function runInit(ctx: CliContext): Promise<number> {
  if (!ctx.repoRoot) {
    ctx.logger.error("Could not find a repository root. Run inside a git repository.");
    return 1;
  }
  const roles = detectRoles(ctx.repoRoot.path);

  if (roles.hasCitadel) {
    ctx.prompts.intro("Citadel already initialized");
    ctx.prompts.log.info(`A citadel config already exists at ${ctx.repoRoot.path}/citadel.yaml.`);
    ctx.prompts.log.message("Re-running this flow will not overwrite the existing file.");
    ctx.prompts.log.message(
      "To edit the citadel, open citadel.yaml directly (edit verbs coming in a later release).",
    );
    ctx.prompts.outro("Nothing changed.");
    return 0;
  }

  ctx.prompts.intro("Initialize a citadel");

  try {
    const shouldProceed = await ctx.prompts.confirm({
      message: `Create a citadel.yaml at ${ctx.repoRoot.path}?`,
      initialValue: true,
    });
    if (!shouldProceed) {
      ctx.prompts.outro("Cancelled — no files written.");
      return 0;
    }

    const sources: MaesterSource[] = [];
    while (true) {
      const source = await collectOneSource(ctx, sources);
      sources.push(source);
      const addAnother = await ctx.prompts.confirm({
        message: "Add another maester?",
        initialValue: false,
      });
      if (!addAnother) break;
    }

    try {
      detectDestinationCollisions(ctx.repoRoot.path, sources);
    } catch (err) {
      ctx.prompts.log.error((err as Error).message);
      ctx.prompts.outro("Cancelled due to destination collision. Re-run when resolved.");
      return 1;
    }

    const confirmWrite = await ctx.prompts.confirm({
      message: `Write ${sources.length} source(s) to citadel.yaml?`,
      initialValue: true,
    });
    if (!confirmWrite) {
      ctx.prompts.outro("Cancelled — no files written.");
      return 0;
    }

    const result = await finalizeCitadel(ctx.repoRoot.path, sources);
    ctx.prompts.log.success(`Wrote ${result.citadelPath}`);
    if (result.gitignoreAdded.length > 0) {
      ctx.prompts.log.success(`Appended to .gitignore: ${result.gitignoreAdded.join(", ")}`);
    }
    if (result.packageJsonScript === "added") {
      ctx.prompts.log.success('Added "maester:sync" script to package.json.');
    } else if (result.packageJsonScript === "no-package-json") {
      ctx.prompts.log.info("No package.json found — skipping script wire-up.");
    }
    const tokenSources = sources.filter((s) => s.auth?.type === "token");
    if (tokenSources.length > 0) {
      const names = tokenSources
        .map((s) => `${s.name} -> ${s.auth?.type === "token" ? s.auth.envVar : ""}`)
        .join(", ");
      ctx.prompts.log.info(`Remember to set these env vars before syncing: ${names}`);
    }
    ctx.prompts.outro("Next: run `npx maester sync` to fetch your sources.");
    return 0;
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      ctx.prompts.outro("Cancelled — no files written.");
      return 130;
    }
    throw err;
  }
}

async function collectOneSource(
  ctx: CliContext,
  existing: readonly MaesterSource[],
): Promise<MaesterSource> {
  const name = await ctx.prompts.text({
    message: "Source name (short, kebab-case, e.g. 'design-system')",
    validate: (value) => {
      const trimmed = value.trim();
      const result = validateSourceName(trimmed);
      if (!result.ok) return result.reason;
      if (existing.some((s) => s.name === trimmed)) {
        return `Source name '${trimmed}' is already used in this citadel.`;
      }
      return undefined;
    },
  });

  const url = await ctx.prompts.text({
    message: "Git URL (https://, ssh://, or git@host:path)",
    validate: (value) => {
      const result = validateGitUrl(value.trim());
      return result.ok ? undefined : result.reason;
    },
  });

  const ref = await ctx.prompts.text({
    message:
      "Ref to pin (branch, tag, or commit SHA) — leave blank for the remote's default branch",
    placeholder: "main",
  });

  const authType = await ctx.prompts.select<"none" | "token">({
    message: "How should this source authenticate?",
    initialValue: "none",
    options: [
      { value: "none", label: "Delegate to my local git (SSH key, credential helper, gh auth)" },
      { value: "token", label: "Token via environment variable" },
    ],
  });

  let auth: AuthRef | undefined;
  if (authType === "token") {
    const envVar = await ctx.prompts.text({
      message: "Enter the NAME of the environment variable (not the token itself)",
      placeholder: "MAESTER_DOCS_TOKEN",
      validate: (value) => {
        const result = validateEnvVarName(value.trim());
        return result.ok ? undefined : result.reason;
      },
    });
    const check = validateEnvVarName(envVar.trim());
    if (check.ok && check.warning) {
      const proceed = await ctx.prompts.confirm({
        message: `${check.warning}\n  Continue with '${envVar.trim()}' as the env-var name?`,
        initialValue: false,
      });
      if (!proceed) {
        return collectOneSource(ctx, existing);
      }
    }
    auth = { type: "token", envVar: envVar.trim() };
  }

  const destination = await ctx.prompts.text({
    message: `Destination override (optional, relative to repo root). Default is citadel/${name.trim()}`,
    placeholder: "",
    validate: (value) => {
      const result = validateDestination(value.trim());
      return result.ok ? undefined : result.reason;
    },
  });

  const trimmedRef = ref.trim();
  const trimmedDest = destination.trim();
  const source: MaesterSource = {
    name: name.trim(),
    url: url.trim(),
    ...(trimmedRef ? { ref: trimmedRef } : {}),
    ...(auth ? { auth } : {}),
    ...(trimmedDest ? { destination: trimmedDest } : {}),
  };
  return source;
}
