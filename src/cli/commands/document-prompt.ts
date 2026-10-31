import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { globby } from "globby";
import {
  isGlobPath,
  parseTags,
  validateCategory,
  validateDocumentPath,
  validateTags,
} from "../../core/publish/validators.js";
import type { State } from "../../core/state/schema.js";
import type { PublishedDocument } from "../../schemas/maester.js";
import type { CliContext } from "../context.js";

/**
 * Per-document prompts shared by `maester publish` and the `publish add`
 * config-editing verb (architecture §6.18).
 */
type PublishedDocumentStateChoice = "draft" | "canon" | "file-header";

export function buildPublishedDocumentStateField(
  choice: PublishedDocumentStateChoice,
): { state: State } | Record<string, never> {
  if (choice === "file-header") return {};
  return { state: choice };
}

export async function askDocumentState(
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

export async function collectOneDocument(
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
