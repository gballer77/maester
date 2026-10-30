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
  validateLocalDirectory,
  validateLocalPathShape,
  validateSourceName,
  validateTag,
} from "../../core/init/validators.js";
import { runSkillInstall } from "../../core/skill/runner.js";
import { listSkillTargets } from "../../core/skill/targets/index.js";
import type { SkillTargetId } from "../../core/skill/types.js";
import { SKILL_VERSION } from "../../core/skill/version.js";
import { readManifestProbe } from "../../core/sources/filter-mode.js";
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
      const source = await promptSourceEntry(ctx, reservedNames(), effectiveBaseDir);
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

/**
 * Prompt for one citadel source: git repository or local directory. Exported
 * so the config-editing `add` verb reuses it rather than duplicating it.
 */
export async function promptSourceEntry(
  ctx: CliContext,
  reservedNames: Set<string>,
  effectiveBaseDir: string,
): Promise<Source> {
  const name = (
    await ctx.prompts.text({
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
    })
  ).trim();

  const kind = await ctx.prompts.select<"git" | "path">({
    message: "Git repository or local directory?",
    initialValue: "git",
    options: [
      { value: "git", label: "Git repository", hint: "fetched by URL into a local cache" },
      {
        value: "path",
        label: "Local directory",
        hint: "read straight from this machine — no git, no network",
      },
    ],
  });

  const location =
    kind === "git"
      ? await collectGitLocation(ctx)
      : await collectLocalLocation(ctx, name, effectiveBaseDir);
  const destination = await collectDestination(ctx, name, effectiveBaseDir);

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

  return buildSourceEntry({
    name,
    location,
    destination: destination.trim(),
    description: description.trim(),
    tags: parseTagsEntries(tagsRaw),
  });
}

export type GitLocation = {
  kind: "git";
  url: string;
  ref: string;
  includes: IncludeEntry[];
  auth: AuthRef | undefined;
};

export type LocalLocation = {
  kind: "path";
  /** Exactly as typed; expansion happens at sync time. */
  path: string;
  mode: "link" | "copy";
  includes: IncludeEntry[];
};

/**
 * Assemble a config entry from collected answers. `path` is written as typed
 * and `mode` only when it is `copy` (link is the default), so the result
 * round-trips through validation unchanged.
 */
export function buildSourceEntry(input: {
  name: string;
  location: GitLocation | LocalLocation;
  destination: string;
  description: string;
  tags: string[];
}): Source {
  const { location } = input;
  const where =
    location.kind === "git"
      ? {
          url: location.url,
          ...(location.ref ? { ref: location.ref } : {}),
        }
      : {
          path: location.path,
          ...(location.mode === "copy" ? { mode: "copy" as const } : {}),
        };
  return {
    name: input.name,
    ...where,
    ...(location.includes.length > 0 ? { includes: location.includes } : {}),
    ...(location.kind === "git" && location.auth ? { auth: location.auth } : {}),
    ...(input.destination ? { destination: input.destination } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.tags.length > 0 ? { tags: input.tags } : {}),
  };
}

async function collectGitLocation(ctx: CliContext): Promise<GitLocation> {
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
  return { kind: "git", url: url.trim(), ref: ref.trim(), includes, auth };
}

async function collectLocalLocation(
  ctx: CliContext,
  name: string,
  effectiveBaseDir: string,
): Promise<LocalLocation> {
  let path: string;
  let real: string;
  while (true) {
    path = (
      await ctx.prompts.text({
        message:
          "Directory path (relative to this repo, absolute, ~/…, or with ${ENV_VAR} placeholders)",
        placeholder: "../platform-docs",
        validate: (value) => {
          const result = validateLocalPathShape(value);
          return result.ok ? undefined : result.reason;
        },
      })
    ).trim();
    const checked = await validateLocalDirectory(name, path, {
      repoRoot: ctx.repoRoot.path,
      baseDir: effectiveBaseDir,
      env: process.env,
    });
    if (checked.ok) {
      real = checked.real;
      break;
    }
    ctx.prompts.log.error(checked.reason);
  }

  const mode = await ctx.prompts.select<"link" | "copy">({
    message: "Link or copy the files into the citadel?",
    initialValue: "link",
    options: [
      {
        value: "link",
        label: "link",
        hint: "symlinks to the live files; gitignored, machine-specific",
      },
      {
        value: "copy",
        label: "copy",
        hint: "a committable snapshot; refreshed on each sync",
      },
    ],
  });

  const probe = await readManifestProbe(real);
  if (probe.kind === "valid") {
    ctx.prompts.log.info(
      "Found a maester.yaml with published entries — skip `includes` to let it drive what is surfaced.",
    );
    return { kind: "path", path, mode, includes: await collectIncludes(ctx) };
  }
  // Copy mode needs a declared set: without one sync would surface the whole
  // directory, which is link-only.
  const includes =
    mode === "copy" ? await collectIncludes(ctx, { required: true }) : await collectIncludes(ctx);
  return { kind: "path", path, mode, includes };
}

async function collectIncludes(
  ctx: CliContext,
  options: { required?: boolean } = {},
): Promise<IncludeEntry[]> {
  if (options.required) {
    ctx.prompts.log.info(
      "Copy mode needs a declared file set: this directory has no maester.yaml with published entries.",
    );
  }
  const useExplicit =
    options.required ||
    (await ctx.prompts.confirm({
      message:
        "Declare an explicit `includes` list? (Skip to use the source's maester.yaml if it has one; otherwise the whole repository is linked in, minus built-in excludes.)",
      initialValue: false,
    }));
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
