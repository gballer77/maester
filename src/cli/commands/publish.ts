import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { globby } from "globby";
import { detectRoles } from "../../core/config/paths.js";
import { detectDuplicatePaths, finalizeMaesterManifest } from "../../core/publish/finalize.js";
import {
  isGlobPath,
  parseTags,
  validateCategory,
  validateDocumentPath,
  validateTags,
} from "../../core/publish/validators.js";
import type { State } from "../../core/state/schema.js";
import type { PublishedDocument } from "../../schemas/maester.js";
import { PromptCancelledError } from "../../ui/prompts.js";
import type { CliContext } from "../context.js";

type PublishedDocumentStateChoice = "draft" | "canon" | "file-header";

export function buildPublishedDocumentStateField(
  choice: PublishedDocumentStateChoice,
): { state: State } | Record<string, never> {
  if (choice === "file-header") return {};
  return { state: choice };
}

async function askDocumentState(
  ctx: CliContext,
  path: string,
): Promise<PublishedDocumentStateChoice> {
  return ctx.prompts.select<PublishedDocumentStateChoice>({
    message: `State for '${path}'?`,
    initialValue: "file-header",
    options: [
      { value: "draft", label: "draft", hint: "tag this entry as draft" },
      { value: "canon", label: "canon", hint: "tag this entry as canon" },
      {
        value: "file-header",
        label: "file header",
        hint: "no rule; defer to inline state in the file",
      },
    ],
  });
}

export function registerPublish(program: Command, getContext: () => CliContext): void {
  program
    .command("publish")
    .description("Configure this repository as a maester (walkthrough).")
    .action(async () => {
      await runPublish(getContext());
    });
}

export async function runPublish(ctx: CliContext): Promise<number> {
  const roles = detectRoles(ctx.repoRoot.path);

  if (roles.hasMaester) {
    ctx.prompts.intro("Maester manifest already configured");
    ctx.prompts.log.info(`A maester.yaml already exists at ${ctx.repoRoot.path}/maester.yaml.`);
    ctx.prompts.log.message("Re-running this flow will not overwrite the existing file.");
    ctx.prompts.outro("Nothing changed.");
    return 0;
  }

  ctx.prompts.intro("Configure this repo as a maester");

  const documents: PublishedDocument[] = [];
  const readmePath = resolve(ctx.repoRoot.path, "README.md");
  if (existsSync(readmePath)) {
    const useReadme = await ctx.prompts.confirm({
      message: "Publish README.md (the most common starter document)?",
      initialValue: true,
    });
    if (useReadme) {
      const stateChoice = await askDocumentState(ctx, "README.md");
      documents.push({
        path: "README.md",
        category: "readme",
        ...buildPublishedDocumentStateField(stateChoice),
      });
      ctx.prompts.log.success("Added README.md");
    }
  }

  try {
    while (true) {
      const addMore = await ctx.prompts.confirm({
        message: documents.length === 0 ? "Add a published document?" : "Add another document?",
        initialValue: documents.length === 0,
      });
      if (!addMore) break;
      const doc = await collectOneDocument(ctx, ctx.repoRoot.path, documents);
      documents.push(doc);
    }
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      ctx.prompts.outro("Cancelled — no files written.");
      return 130;
    }
    throw err;
  }

  if (documents.length === 0) {
    ctx.prompts.log.error("A maester manifest must declare at least one document.");
    ctx.prompts.outro("Cancelled — no files written.");
    return 1;
  }

  try {
    detectDuplicatePaths(documents);
  } catch (err) {
    ctx.prompts.log.error((err as Error).message);
    ctx.prompts.outro("Cancelled.");
    return 1;
  }

  const confirmWrite = await ctx.prompts.confirm({
    message: `Write ${documents.length} document(s) to maester.yaml?`,
    initialValue: true,
  });
  if (!confirmWrite) {
    ctx.prompts.outro("Cancelled — no files written.");
    return 0;
  }

  const result = await finalizeMaesterManifest(ctx.repoRoot.path, documents);
  ctx.prompts.log.success(`Wrote ${result.maesterPath} (${result.documentCount} document(s))`);
  ctx.prompts.outro("Consuming citadels will pick up this manifest at their next `maester sync`.");
  return 0;
}

async function collectOneDocument(
  ctx: CliContext,
  repoRoot: string,
  existing: readonly PublishedDocument[],
): Promise<PublishedDocument> {
  const path = await ctx.prompts.text({
    message: "Path or glob (relative to the repo root)",
    placeholder: "docs/runbooks/**/*.md",
    validate: (value) => {
      const trimmed = value.trim();
      const result = validateDocumentPath(trimmed);
      if (!result.ok) return result.reason;
      if (existing.some((d) => d.path === trimmed)) {
        return `Path '${trimmed}' is already declared in this manifest.`;
      }
      return undefined;
    },
  });
  const trimmed = path.trim();

  if (isGlobPath(trimmed)) {
    const matches = await globby(trimmed, { cwd: repoRoot, dot: false, gitignore: false });
    ctx.prompts.log.info(`Glob matches ${matches.length} file(s) currently.`);
  } else {
    if (!existsSync(resolve(repoRoot, trimmed))) {
      ctx.prompts.log.warning(`'${trimmed}' does not yet exist in this repo. Saving anyway.`);
    }
  }

  const stateChoice = await askDocumentState(ctx, trimmed);

  const description = await ctx.prompts.text({
    message: "Description (optional)",
    placeholder: "",
  });
  const category = await ctx.prompts.text({
    message: "Category slug (optional, e.g. 'readme', 'adr', 'runbook')",
    placeholder: "",
    validate: (value) => {
      const result = validateCategory(value.trim());
      return result.ok ? undefined : result.reason;
    },
  });
  const tagsRaw = await ctx.prompts.text({
    message: "Tags (comma-separated, optional)",
    placeholder: "",
    validate: (value) => {
      const result = validateTags(value.trim());
      return result.ok ? undefined : result.reason;
    },
  });

  const trimmedDesc = description.trim();
  const trimmedCat = category.trim();
  const tags = parseTags(tagsRaw.trim());

  const doc: PublishedDocument = {
    path: trimmed,
    ...(trimmedDesc ? { description: trimmedDesc } : {}),
    ...(trimmedCat ? { category: trimmedCat } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...buildPublishedDocumentStateField(stateChoice),
  };
  return doc;
}
