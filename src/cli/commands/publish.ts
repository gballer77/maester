import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { detectRoles } from "../../core/config/paths.js";
import { detectDuplicatePaths, finalizeMaesterManifest } from "../../core/publish/finalize.js";
import { type SkillTargetId, listSkillTargets, runSkillInstall } from "../../core/skill/runner.js";
import { DEFAULT_BASE_DIR } from "../../schemas/citadel.js";
import type { PublishedDocument } from "../../schemas/maester.js";
import { PromptCancelledError } from "../../ui/prompts.js";
import type { CliContext } from "../context.js";
import {
  askDocumentState,
  buildPublishedDocumentStateField,
  collectOneDocument,
} from "./document-prompt.js";
import { registerPublishEdit } from "./edit.js";
import { registerPublishAgent } from "./publish-agent.js";

export { buildPublishedDocumentStateField };

export function registerPublish(program: Command, getContext: () => CliContext): void {
  const publish = program
    .command("publish")
    .description(
      "Configure this repository as a maester (walkthrough). Use `publish add | remove | list` to edit an existing manifest.",
    )
    .action(async () => {
      await runPublish(getContext());
    });
  registerPublishEdit(publish, getContext);
  registerPublishAgent(publish, getContext);
}

export async function runPublish(ctx: CliContext): Promise<number> {
  const roles = detectRoles(ctx.repoRoot.path);

  if (roles.hasMaester) {
    ctx.prompts.intro("Maester manifest already configured");
    ctx.prompts.log.info(`A maester.yaml already exists at ${ctx.repoRoot.path}/maester.yaml.`);
    ctx.prompts.log.message("Re-running this flow will not overwrite the existing file.");
    ctx.prompts.log.message(
      "To edit it, run `maester publish add`, `maester publish remove`, or `maester publish list`.",
    );
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
    const publishWhole = await ctx.prompts.confirm({
      message:
        "No documents added. Publish the whole repository? Citadels will link every file except built-in excludes (dependency/build folders, binaries, files over 1 MiB).",
      initialValue: false,
    });
    if (!publishWhole) {
      ctx.prompts.outro("Cancelled — no files written.");
      return 0;
    }
  }

  try {
    detectDuplicatePaths(documents);
  } catch (err) {
    ctx.prompts.log.error((err as Error).message);
    ctx.prompts.outro("Cancelled.");
    return 1;
  }

  if (documents.length > 0) {
    const confirmWrite = await ctx.prompts.confirm({
      message: `Write ${documents.length} document(s) to maester.yaml?`,
      initialValue: true,
    });
    if (!confirmWrite) {
      ctx.prompts.outro("Cancelled — no files written.");
      return 0;
    }
  }

  const result = await finalizeMaesterManifest(ctx.repoRoot.path, documents);
  ctx.prompts.log.success(
    result.documentCount === 0
      ? `Wrote ${result.maesterPath} — the whole repository is published`
      : `Wrote ${result.maesterPath} (${result.documentCount} document(s))`,
  );
  await offerPublisherSkill(ctx);
  ctx.prompts.outro("Consuming citadels will pick up this manifest at their next `maester sync`.");
  return 0;
}

/**
 * Final, optional step (architecture §6.19, Gap 83): install the Publisher
 * so the user's coding agent can maintain this manifest. Defaults to No; a
 * cancel here only skips the install — the manifest is already written.
 */
async function offerPublisherSkill(ctx: CliContext): Promise<void> {
  try {
    const install = await ctx.prompts.confirm({
      message:
        "Install the Publisher agent skill? It lets your coding agent propose and maintain maester.yaml entries for your review.",
      initialValue: false,
    });
    if (!install) return;
    const targets = await ctx.prompts.multiselect<SkillTargetId>({
      message: "Which agent(s) should the Publisher be installed for?",
      options: listSkillTargets("publisher").map((t) => ({ value: t.id, label: t.label })),
      initialValues: ["claude-code"] as SkillTargetId[],
      required: true,
    });
    const result = await runSkillInstall(ctx.repoRoot.path, {
      kind: "publisher",
      targets,
      mode: "install",
      citadelBaseDir: DEFAULT_BASE_DIR,
    });
    for (const o of result.outcomes) {
      if (o.action === "failed") {
        ctx.prompts.log.error(`Publisher · ${o.label}: failed${o.error ? ` — ${o.error}` : ""}`);
      } else {
        ctx.prompts.log.success(
          `Publisher · ${o.label}: ${o.action} → ${o.artifactPaths.join(", ")}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof PromptCancelledError) return;
    throw err;
  }
}
