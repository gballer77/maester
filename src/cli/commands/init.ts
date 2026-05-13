import type { Command } from "commander";
import { detectRoles } from "../../core/config/paths.js";
import { detectDestinationCollisions, finalizeCitadel } from "../../core/init/finalize.js";
import {
  validateDestination,
  validateEnvVarName,
  validateGitUrl,
  validateIncludesEntry,
  validateSourceName,
  validateTag,
} from "../../core/init/validators.js";
import type { AuthRef, MaesterSource, RavenSource } from "../../schemas/citadel.js";
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

    const maesters: MaesterSource[] = [];
    const ravens: RavenSource[] = [];

    const reservedNames = (): Set<string> =>
      new Set([...maesters.map((m) => m.name), ...ravens.map((r) => r.name)]);

    while (true) {
      const source = await collectOneMaester(ctx, reservedNames());
      maesters.push(source);
      const addAnother = await ctx.prompts.confirm({
        message: "Add another maester?",
        initialValue: false,
      });
      if (!addAnother) break;
    }

    const addRavens = await ctx.prompts.confirm({
      message: "Register any ravens? (third-party sources without a maester.yaml)",
      initialValue: false,
    });
    if (addRavens) {
      while (true) {
        const raven = await collectOneRaven(ctx, reservedNames());
        ravens.push(raven);
        const addAnother = await ctx.prompts.confirm({
          message: "Add another raven?",
          initialValue: false,
        });
        if (!addAnother) break;
      }
    }

    try {
      detectDestinationCollisions(ctx.repoRoot.path, { maesters, ravens });
    } catch (err) {
      ctx.prompts.log.error((err as Error).message);
      ctx.prompts.outro("Cancelled due to destination collision. Re-run when resolved.");
      return 1;
    }

    const summary =
      ravens.length > 0
        ? `Write ${maesters.length} maester(s) and ${ravens.length} raven(s) to citadel.yaml?`
        : `Write ${maesters.length} maester(s) to citadel.yaml?`;
    const confirmWrite = await ctx.prompts.confirm({
      message: summary,
      initialValue: true,
    });
    if (!confirmWrite) {
      ctx.prompts.outro("Cancelled — no files written.");
      return 0;
    }

    const result = await finalizeCitadel(ctx.repoRoot.path, { maesters, ravens });
    ctx.prompts.log.success(`Wrote ${result.citadelPath}`);
    if (result.gitignoreAdded.length > 0) {
      ctx.prompts.log.success(`Appended to .gitignore: ${result.gitignoreAdded.join(", ")}`);
    }
    if (result.packageJsonScript === "added") {
      ctx.prompts.log.success('Added "maester:sync" script to package.json.');
    } else if (result.packageJsonScript === "no-package-json") {
      ctx.prompts.log.info("No package.json found — skipping script wire-up.");
    }
    const tokenEntries: { kind: "maester" | "raven"; name: string; envVar: string }[] = [];
    for (const m of maesters) {
      if (m.auth?.type === "token") {
        tokenEntries.push({ kind: "maester", name: m.name, envVar: m.auth.envVar });
      }
    }
    for (const r of ravens) {
      if (r.auth?.type === "token") {
        tokenEntries.push({ kind: "raven", name: r.name, envVar: r.auth.envVar });
      }
    }
    if (tokenEntries.length > 0) {
      const summary = tokenEntries.map((t) => `${t.name} (${t.kind}) -> ${t.envVar}`).join(", ");
      ctx.prompts.log.info(`Remember to set these env vars before syncing: ${summary}`);
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

async function collectOneMaester(
  ctx: CliContext,
  reservedNames: Set<string>,
): Promise<MaesterSource> {
  const name = await ctx.prompts.text({
    message: "Maester name (short, kebab-case, e.g. 'design-system')",
    validate: (value) => {
      const trimmed = value.trim();
      const result = validateSourceName(trimmed);
      if (!result.ok) return result.reason;
      if (reservedNames.has(trimmed)) {
        return `Name '${trimmed}' is already used in this citadel.`;
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

  const auth = await collectAuth(ctx);
  const destination = await collectDestination(ctx, name.trim());

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

async function collectOneRaven(ctx: CliContext, reservedNames: Set<string>): Promise<RavenSource> {
  ctx.prompts.log.message(
    "Ravens are pulled without a maester.yaml on the remote side — you'll declare what to include.",
  );

  const name = await ctx.prompts.text({
    message: "Raven name (short, kebab-case, e.g. 'react-docs')",
    validate: (value) => {
      const trimmed = value.trim();
      const result = validateSourceName(trimmed);
      if (!result.ok) return result.reason;
      if (reservedNames.has(trimmed)) {
        return `Name '${trimmed}' is already used in this citadel.`;
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

  const includesRaw = await ctx.prompts.text({
    message:
      "Includes — repo-relative paths or globs, comma- or whitespace-separated. At least one required.",
    placeholder: "docs/**/*.md, README.md",
    validate: (value) => {
      const entries = parseIncludesEntries(value);
      if (entries.length === 0) return "At least one includes entry is required.";
      for (const entry of entries) {
        const result = validateIncludesEntry(entry);
        if (!result.ok) return `'${entry}': ${result.reason}`;
      }
      return undefined;
    },
  });
  const includes = parseIncludesEntries(includesRaw);

  const auth = await collectAuth(ctx);
  const destination = await collectDestination(ctx, name.trim());

  const description = await ctx.prompts.text({
    message: "Description (optional — short free text)",
    placeholder: "",
  });

  const tagsRaw = await ctx.prompts.text({
    message: "Tags (optional — comma-separated slugs)",
    placeholder: "docs, upstream",
    validate: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return undefined;
      const tags = parseTagsEntries(trimmed);
      for (const tag of tags) {
        const result = validateTag(tag);
        if (!result.ok) return `'${tag}': ${result.reason}`;
      }
      return undefined;
    },
  });
  const tags = parseTagsEntries(tagsRaw);

  const trimmedRef = ref.trim();
  const trimmedDest = destination.trim();
  const trimmedDesc = description.trim();
  const raven: RavenSource = {
    name: name.trim(),
    url: url.trim(),
    ...(trimmedRef ? { ref: trimmedRef } : {}),
    includes,
    ...(auth ? { auth } : {}),
    ...(trimmedDest ? { destination: trimmedDest } : {}),
    ...(trimmedDesc ? { description: trimmedDesc } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
  return raven;
}

async function collectAuth(ctx: CliContext): Promise<AuthRef | undefined> {
  const authType = await ctx.prompts.select<"none" | "token">({
    message: "How should this source authenticate?",
    initialValue: "none",
    options: [
      { value: "none", label: "Delegate to my local git (SSH key, credential helper, gh auth)" },
      { value: "token", label: "Token via environment variable" },
    ],
  });

  if (authType !== "token") return undefined;

  while (true) {
    const envVar = await ctx.prompts.text({
      message: "Enter the NAME of the environment variable (not the token itself)",
      placeholder: "MAESTER_DOCS_TOKEN",
      validate: (value) => {
        const result = validateEnvVarName(value.trim());
        return result.ok ? undefined : result.reason;
      },
    });
    const trimmed = envVar.trim();
    const check = validateEnvVarName(trimmed);
    if (check.ok && check.warning) {
      const proceed = await ctx.prompts.confirm({
        message: `${check.warning}\n  Continue with '${trimmed}' as the env-var name?`,
        initialValue: false,
      });
      if (!proceed) continue;
    }
    return { type: "token", envVar: trimmed };
  }
}

async function collectDestination(ctx: CliContext, name: string): Promise<string> {
  return ctx.prompts.text({
    message: `Destination override (optional, relative to repo root). Default is citadel/${name}`,
    placeholder: "",
    validate: (value) => {
      const result = validateDestination(value.trim());
      return result.ok ? undefined : result.reason;
    },
  });
}

function parseIncludesEntries(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseTagsEntries(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
