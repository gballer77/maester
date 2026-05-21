import type { Command } from "commander";
import { detectRoles } from "../../core/config/paths.js";
import { listConnectorTypes } from "../../core/connectors/registry.js";
import { detectDestinationCollisions, finalizeCitadel } from "../../core/init/finalize.js";
import {
  validateBaseDir,
  validateDestination,
  validateEnvVarName,
  validateGitUrl,
  validateIncludesEntry,
  validateSourceName,
  validateTag,
} from "../../core/init/validators.js";
import { runSkillInstall } from "../../core/skill/runner.js";
import { listSkillTargets } from "../../core/skill/targets/index.js";
import type { SkillTargetId } from "../../core/skill/types.js";
import { SKILL_VERSION } from "../../core/skill/version.js";
import type { State } from "../../core/state/schema.js";
import {
  type AuthRef,
  type Connector,
  DEFAULT_BASE_DIR,
  type IncludeEntry,
  type Source,
} from "../../schemas/citadel.js";
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

    const baseDir = await collectBaseDir(ctx);
    const effectiveBaseDir = baseDir ?? DEFAULT_BASE_DIR;

    const sources: Source[] = [];
    const reservedNames = (): Set<string> => new Set(sources.map((s) => s.name));

    while (true) {
      const source = await collectOneSource(ctx, reservedNames(), effectiveBaseDir);
      sources.push(source);
      const addAnother = await ctx.prompts.confirm({
        message: "Add another source?",
        initialValue: false,
      });
      if (!addAnother) break;
    }

    try {
      detectDestinationCollisions(ctx.repoRoot.path, {
        sources,
        ...(baseDir ? { baseDir } : {}),
      });
    } catch (err) {
      ctx.prompts.log.error((err as Error).message);
      ctx.prompts.outro("Cancelled due to destination collision. Re-run when resolved.");
      return 1;
    }

    const connectors = await collectConnectors(ctx);

    const confirmWrite = await ctx.prompts.confirm({
      message: `Write ${sources.length} source(s)${connectors.length > 0 ? ` and ${connectors.length} connector(s)` : ""} to citadel.yaml?`,
      initialValue: true,
    });
    if (!confirmWrite) {
      ctx.prompts.outro("Cancelled — no files written.");
      return 0;
    }

    const result = await finalizeCitadel(ctx.repoRoot.path, {
      sources,
      ...(baseDir ? { baseDir } : {}),
      ...(connectors.length > 0 ? { connectors } : {}),
    });
    ctx.prompts.log.success(`Wrote ${result.citadelPath}`);
    if (result.gitignoreAdded.length > 0) {
      ctx.prompts.log.success(`Appended to .gitignore: ${result.gitignoreAdded.join(", ")}`);
    }
    if (result.packageJsonScript === "added") {
      ctx.prompts.log.success('Added "maester:sync" script to package.json.');
    } else if (result.packageJsonScript === "no-package-json") {
      ctx.prompts.log.info("No package.json found — skipping script wire-up.");
    }
    const tokenEntries: { name: string; envVar: string }[] = [];
    for (const s of sources) {
      if (s.auth?.type === "token") {
        tokenEntries.push({ name: s.name, envVar: s.auth.envVar });
      }
    }
    if (tokenEntries.length > 0) {
      const summary = tokenEntries.map((t) => `${t.name} -> ${t.envVar}`).join(", ");
      ctx.prompts.log.info(`Remember to set these env vars before syncing: ${summary}`);
    }

    await maybeInstallSkill(ctx, baseDir ?? DEFAULT_BASE_DIR);

    ctx.prompts.outro("Next: run `npx baller-maester sync` to fetch your sources.");
    return 0;
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      ctx.prompts.outro("Cancelled — no files written.");
      return 130;
    }
    throw err;
  }
}

async function maybeInstallSkill(ctx: CliContext, baseDir: string): Promise<void> {
  let wantsSkill: boolean;
  try {
    wantsSkill = await ctx.prompts.confirm({
      message: "Install the Grand Maester agent skill? (Recommended)",
      initialValue: true,
    });
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      ctx.prompts.log.info(
        "Skill install cancelled — citadel is configured. Run `maester skill install` later if you change your mind.",
      );
      return;
    }
    throw err;
  }
  if (!wantsSkill) return;

  let targets: SkillTargetId[];
  try {
    targets = await ctx.prompts.multiselect<SkillTargetId>({
      message: "Which agent(s) should the skill be installed for?",
      options: listSkillTargets().map((t) => ({ value: t.id, label: t.label })),
      initialValues: ["claude-code", "codex"] as SkillTargetId[],
      required: true,
    });
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      ctx.prompts.log.info(
        "Skill install cancelled — citadel is configured. Run `maester skill install` later if you change your mind.",
      );
      return;
    }
    throw err;
  }
  if (targets.length === 0) return;

  try {
    const result = await runSkillInstall(ctx.repoRoot.path, {
      targets,
      mode: "install",
      citadelBaseDir: baseDir,
    });
    for (const outcome of result.outcomes) {
      const artifacts = outcome.artifactPaths.join(", ");
      if (outcome.action === "failed") {
        ctx.prompts.log.error(
          `${outcome.label}: failed${outcome.error ? ` — ${outcome.error}` : ""}`,
        );
      } else if (outcome.action === "installed" || outcome.action === "upgraded") {
        ctx.prompts.log.success(`${outcome.label}: ${outcome.action} → ${artifacts}`);
      } else {
        ctx.prompts.log.info(`${outcome.label}: already up to date (${artifacts})`);
      }
    }
    const total = result.counts.installed + result.counts.upgraded + result.counts.unchanged;
    if (result.counts.failed === 0 && total > 0) {
      ctx.prompts.log.success(
        `Grand Maester installed for ${total} target(s) at v${SKILL_VERSION}.`,
      );
    }
  } catch (err) {
    ctx.prompts.log.error(
      `Skill install failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function collectOneSource(
  ctx: CliContext,
  reservedNames: Set<string>,
  effectiveBaseDir: string,
): Promise<Source> {
  const name = await ctx.prompts.text({
    message: "Source name (short, kebab-case, e.g. 'design-system')",
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

  const includes = await collectIncludes(ctx);
  const auth = await collectAuth(ctx);
  const destination = await collectDestination(ctx, name.trim(), effectiveBaseDir);

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
  const source: Source = {
    name: name.trim(),
    url: url.trim(),
    ...(trimmedRef ? { ref: trimmedRef } : {}),
    ...(includes.length > 0 ? { includes } : {}),
    ...(auth ? { auth } : {}),
    ...(trimmedDest ? { destination: trimmedDest } : {}),
    ...(trimmedDesc ? { description: trimmedDesc } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
  return source;
}

async function collectIncludes(ctx: CliContext): Promise<IncludeEntry[]> {
  const useExplicit = await ctx.prompts.confirm({
    message:
      "Declare an explicit `includes` list? (Skip to let the source's own maester.yaml manifest drive what gets pulled.)",
    initialValue: false,
  });
  if (!useExplicit) return [];

  const raw = await ctx.prompts.text({
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

  const paths = parseIncludesEntries(raw);
  const entries: IncludeEntry[] = [];
  for (const path of paths) {
    const choice = await ctx.prompts.select<IncludesStateChoice>({
      message: `State for '${path}'?`,
      initialValue: "file-header",
      options: [
        { value: "draft", label: "draft", hint: "tag this entry as draft" },
        { value: "canon", label: "canon", hint: "tag this entry as canon" },
        {
          value: "file-header",
          label: "file header",
          hint: "no rule; defer to inline state in each file",
        },
      ],
    });
    entries.push(buildIncludeEntry(path, choice));
  }
  return entries;
}

type IncludesStateChoice = "draft" | "canon" | "file-header";

export function buildIncludeEntry(path: string, choice: IncludesStateChoice): IncludeEntry {
  if (choice === "file-header") return path;
  const state: State = choice;
  return { path, state };
}

async function collectAuth(ctx: CliContext): Promise<AuthRef | undefined> {
  const authType = await ctx.prompts.select<"public" | "delegated" | "token">({
    message: "How should this source authenticate?",
    initialValue: "public",
    options: [
      { value: "public", label: "No auth required (public repo)" },
      {
        value: "delegated",
        label: "Delegate to my local git (SSH key, credential helper, gh auth)",
      },
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

async function collectDestination(
  ctx: CliContext,
  name: string,
  effectiveBaseDir: string,
): Promise<string> {
  return ctx.prompts.text({
    message: `Destination override (optional, relative to repo root). Default is ${effectiveBaseDir}/${name}`,
    placeholder: "",
    validate: (value) => {
      const result = validateDestination(value.trim());
      return result.ok ? undefined : result.reason;
    },
  });
}

async function collectBaseDir(ctx: CliContext): Promise<string | undefined> {
  const raw = await ctx.prompts.text({
    message: `Base directory for synced sources (each defaults to <baseDir>/<name>). Press Enter to accept the default '${DEFAULT_BASE_DIR}'.`,
    placeholder: DEFAULT_BASE_DIR,
    validate: (value) => {
      const result = validateBaseDir(value.trim());
      return result.ok ? undefined : result.reason;
    },
  });
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === DEFAULT_BASE_DIR) return undefined;
  return trimmed;
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

/**
 * Collect connector entries during init (Gap 42 — connector-registration step
 * sits between source registration and the Grand Maester offer). When no
 * connector types are registered in this build, the loop short-circuits with
 * an info log and returns an empty array. When concrete types land (e.g.
 * GitLab Issues), each type's prompt sequence plugs in here.
 */
async function collectConnectors(ctx: CliContext): Promise<Connector[]> {
  const types = listConnectorTypes();
  if (types.length === 0) {
    return [];
  }
  // Future: when a registered type exists, ask the user whether they want to
  // register one or more connectors and dispatch to per-type prompt modules.
  // The framework is in place but no concrete type ships in this run.
  ctx.prompts.log.info(
    `${types.length} connector type(s) available, but interactive registration during init is wired in a follow-on feature. Use \`maester connector add\` after init.`,
  );
  return [];
}
