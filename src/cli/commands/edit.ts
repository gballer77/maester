import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  type EditHandle,
  type EditRole,
  appendEntry,
  commitEdit,
  openConfigForEdit,
  removeEntry,
} from "../../core/config/edit.js";
import { maesterConfigPath } from "../../core/config/paths.js";
import { ConfigError } from "../../core/errors.js";
import { detectDestinationCollisions } from "../../core/init/finalize.js";
import { DEFAULT_BASE_DIR, type Source } from "../../schemas/citadel.js";
import type { PublishedDocument } from "../../schemas/maester.js";
import { renderTable } from "../../ui/components/table.js";
import { PromptCancelledError } from "../../ui/prompts.js";
import type { CliContext } from "../context.js";
import { collectOneDocument } from "./document-prompt.js";
import { promptSourceEntry } from "./init.js";
import {
  type FieldFlags,
  type WriteFlags,
  runFlagAdd,
  runFlagRemove,
  withFieldFlags,
  withWriteFlags,
} from "./publish-agent.js";

/**
 * Config-editing verbs (architecture §6.18): `maester add | remove | list` on
 * citadel sources and `maester publish add | remove | list` on maester
 * documents. Each reuses the init / publish prompts and writes through the
 * comment-preserving, atomic edit engine in `src/core/config/edit.ts`.
 */
export const EXIT_OK = 0;
/** The user declined a confirmation. */
export const EXIT_DECLINED = 1;
/** Missing / invalid config, or a refused edit. */
export const EXIT_REFUSED = 2;
/** Ctrl-C at a prompt. */
export const EXIT_INTERRUPTED = 130;

export function registerEdit(program: Command, getContext: () => CliContext): void {
  program
    .command("add")
    .description("Add a source to this citadel (same prompts as `maester init`).")
    .action(async () => {
      process.exitCode = await runSourceAdd(getContext());
    });
  program
    .command("remove")
    .description("Remove a source from this citadel.")
    .action(async () => {
      process.exitCode = await runSourceRemove(getContext());
    });
  program
    .command("list")
    .description("List the sources declared in this citadel.")
    .action(async () => {
      process.exitCode = await runSourceList(getContext());
    });
}

/** Attach `add | remove | list` to the existing `maester publish` command. */
export function registerPublishEdit(publish: Command, getContext: () => CliContext): void {
  withWriteFlags(
    withFieldFlags(
      publish
        .command("add")
        .description(
          "Add a published document to this maester (same prompts as `maester publish`). With --path, runs without prompts.",
        )
        .option("--path <path>", "Non-interactive: the file or glob to publish.")
        .option("--create", "With --path: create maester.yaml when it does not exist."),
    ),
  ).action(async (options: WriteFlags & FieldFlags & { path?: string }) => {
    const ctx = getContext();
    process.exitCode =
      options.path !== undefined
        ? await runFlagAdd(ctx, { ...options, path: options.path })
        : await runDocumentAdd(ctx);
  });
  publish
    .command("remove")
    .description(
      "Remove a published document from this maester. With --path, runs without prompts.",
    )
    .option("--path <path>", "Non-interactive: the entry's path, exactly as written.")
    .option("--dry-run", "With --path: validate and print the result without writing.")
    .action(async (options: WriteFlags & { path?: string }) => {
      const ctx = getContext();
      process.exitCode =
        options.path !== undefined
          ? await runFlagRemove(ctx, { ...options, path: options.path })
          : await runDocumentRemove(ctx);
    });
  publish
    .command("list")
    .description("List the documents this maester publishes.")
    .action(async () => {
      process.exitCode = await runDocumentList(getContext());
    });
}

// ── citadel sources ─────────────────────────────────────────────────────────

export async function runSourceAdd(ctx: CliContext): Promise<number> {
  return guarded(ctx, "citadel", "Cancelled — citadel.yaml not modified.", async (handle) => {
    const { config } = handle;
    const baseDir = config.baseDir ?? DEFAULT_BASE_DIR;
    ctx.prompts.intro("Add a source");
    const source = await promptSourceEntry(
      ctx,
      new Set(config.sources.map((s) => s.name)),
      baseDir,
    );
    try {
      detectDestinationCollisions(ctx.repoRoot.path, {
        sources: [...config.sources, source],
        ...(config.baseDir ? { baseDir: config.baseDir } : {}),
      });
    } catch (err) {
      ctx.prompts.log.error((err as Error).message);
      ctx.prompts.outro("Not added — citadel.yaml not modified.");
      return EXIT_REFUSED;
    }
    const ok = await ctx.prompts.confirm({
      message: `Append source '${source.name}' to citadel.yaml?`,
      initialValue: true,
    });
    if (!ok) return declined(ctx, "citadel.yaml");
    appendEntry(handle, source);
    await commitEdit(handle);
    ctx.prompts.log.success(`Added source '${source.name}' to ${handle.filePath}.`);
    ctx.prompts.outro("Run `maester sync` to pull the new source.");
    return EXIT_OK;
  });
}

export async function runSourceRemove(ctx: CliContext): Promise<number> {
  return guarded(ctx, "citadel", "Cancelled — citadel.yaml not modified.", async (handle) => {
    const { sources } = handle.config;
    if (sources.length <= 1) {
      ctx.prompts.log.error(
        "A citadel needs at least one source, so the last one cannot be removed. Add another source first (`maester add`), or delete citadel.yaml for a full reset.",
      );
      return EXIT_REFUSED;
    }
    const index = await ctx.prompts.select({
      message: "Which source should be removed?",
      options: sources.map((s, i) => ({
        value: String(i),
        label: s.name,
        hint: sourceLocation(s),
      })),
    });
    const source = sources[Number(index)] as Source;
    ctx.prompts.note(
      "Remove source",
      [
        `name: ${source.name}`,
        `from: ${sourceLocation(source)}`,
        ...(source.description ? [`description: ${source.description}`] : []),
      ].join("\n"),
    );
    const ok = await ctx.prompts.confirm({
      message: `Remove source '${source.name}' from citadel.yaml?`,
      initialValue: false,
    });
    if (!ok) return declined(ctx, "citadel.yaml");
    removeEntry(handle, Number(index));
    await commitEdit(handle);
    ctx.prompts.log.success(`Removed source '${source.name}' from ${handle.filePath}.`);
    const destination = resolve(
      ctx.repoRoot.path,
      source.destination ?? `${handle.config.baseDir ?? DEFAULT_BASE_DIR}/${source.name}`,
    );
    if (existsSync(destination)) {
      ctx.prompts.log.info(
        `Its synced output at ${destination} is not removed automatically — delete it yourself if you no longer need it.`,
      );
    }
    ctx.prompts.outro("Done.");
    return EXIT_OK;
  });
}

export async function runSourceList(ctx: CliContext): Promise<number> {
  return guarded(ctx, "citadel", "", async (handle) => {
    const { config } = handle;
    const baseDir = config.baseDir ?? DEFAULT_BASE_DIR;
    const table = renderTable(ctx.theming, {
      columns: [
        { header: "Name", key: "name" },
        { header: "URL / path", key: "location" },
        { header: "Ref", key: "ref" },
        { header: "Auth", key: "auth" },
        { header: "Destination", key: "destination" },
        { header: "Tags", key: "tags" },
      ],
      rows: config.sources.map((s) => ({
        name: s.name,
        location: s.url ?? s.path ?? "",
        ref: s.url !== undefined ? (s.ref ?? "default branch") : "—",
        auth: s.auth?.type ?? "none",
        destination: s.destination ?? `${baseDir}/${s.name} (default)`,
        tags: s.tags?.join(", ") ?? "",
      })),
    });
    process.stdout.write(`${table}\n`);
    process.stdout.write(`${countLine(config.sources.length, "source")} in ${handle.filePath}\n`);
    return EXIT_OK;
  });
}

function sourceLocation(source: Source): string {
  if (source.path !== undefined) return source.path;
  return `${source.url}${source.ref ? ` @ ${source.ref}` : ""}`;
}

// ── maester documents ───────────────────────────────────────────────────────

export async function runDocumentAdd(ctx: CliContext): Promise<number> {
  return guarded(ctx, "maester", "Cancelled — maester.yaml not modified.", async (handle) => {
    const documents = handle.config.documents ?? [];
    ctx.prompts.intro("Add a published document");
    const doc = await collectOneDocument(ctx, ctx.repoRoot.path, documents);
    if (documents.length === 0) {
      ctx.prompts.log.warning(
        "This manifest currently publishes the whole repository. After this change it publishes only the documents it lists.",
      );
    }
    const ok = await ctx.prompts.confirm({
      message: `Append '${doc.path}' to maester.yaml?`,
      initialValue: true,
    });
    if (!ok) return declined(ctx, "maester.yaml");
    appendEntry(handle, doc);
    await commitEdit(handle);
    ctx.prompts.log.success(`Added '${doc.path}' to ${handle.filePath}.`);
    ctx.prompts.outro("Consuming citadels pick it up at their next `maester sync`.");
    return EXIT_OK;
  });
}

export async function runDocumentRemove(ctx: CliContext): Promise<number> {
  return guarded(ctx, "maester", "Cancelled — maester.yaml not modified.", async (handle) => {
    const documents = handle.config.documents ?? [];
    if (documents.length === 0) {
      ctx.prompts.log.error(
        "This manifest lists no documents (it publishes the whole repository), so there is nothing to remove.",
      );
      return EXIT_REFUSED;
    }
    if (documents.length === 1) {
      ctx.prompts.log.error(
        "The last document cannot be removed: an empty `documents` list publishes the WHOLE repository. Add another document first (`maester publish add`), or edit maester.yaml by hand if whole-repository publishing is what you want.",
      );
      return EXIT_REFUSED;
    }
    const index = await ctx.prompts.select({
      message: "Which document should be removed?",
      options: documents.map((d, i) => ({
        value: String(i),
        label: d.path,
        hint: documentHint(d),
      })),
    });
    const doc = documents[Number(index)] as PublishedDocument;
    ctx.prompts.note(
      "Remove document",
      [`path: ${doc.path}`, ...(doc.description ? [`description: ${doc.description}`] : [])].join(
        "\n",
      ),
    );
    const ok = await ctx.prompts.confirm({
      message: `Remove '${doc.path}' from maester.yaml?`,
      initialValue: false,
    });
    if (!ok) return declined(ctx, "maester.yaml");
    removeEntry(handle, Number(index));
    await commitEdit(handle);
    ctx.prompts.log.success(`Removed '${doc.path}' from ${handle.filePath}.`);
    ctx.prompts.outro("Consuming citadels drop it at their next `maester sync`.");
    return EXIT_OK;
  });
}

export async function runDocumentList(ctx: CliContext): Promise<number> {
  if (ctx.flags.json && !existsSync(maesterConfigPath(ctx.repoRoot.path))) {
    process.stdout.write(
      `${JSON.stringify({ manifest: "none", filePath: maesterConfigPath(ctx.repoRoot.path), documents: [] })}\n`,
    );
    return EXIT_OK;
  }
  return guarded(ctx, "maester", "", async (handle) => {
    const documents = handle.config.documents ?? [];
    if (ctx.flags.json) {
      process.stdout.write(
        `${JSON.stringify({
          manifest: documents.length === 0 ? "whole-repository" : "listed",
          filePath: handle.filePath,
          documents,
        })}\n`,
      );
      return EXIT_OK;
    }
    if (documents.length === 0) {
      process.stdout.write(
        `No documents listed — ${handle.filePath} publishes the whole repository.\n`,
      );
      return EXIT_OK;
    }
    const table = renderTable(ctx.theming, {
      columns: [
        { header: "Path", key: "path" },
        { header: "Category", key: "category" },
        { header: "State", key: "state" },
        { header: "Description", key: "description" },
        { header: "Tags", key: "tags" },
      ],
      rows: documents.map((d) => ({
        path: d.path,
        category: d.category ?? "",
        state: d.state ?? "file header",
        description: d.description ?? "",
        tags: d.tags?.join(", ") ?? "",
      })),
    });
    process.stdout.write(`${table}\n`);
    process.stdout.write(`${countLine(documents.length, "document")} in ${handle.filePath}\n`);
    return EXIT_OK;
  });
}

function documentHint(doc: PublishedDocument): string {
  return [doc.category, doc.state ?? "file header"].filter(Boolean).join(" · ");
}

// ── shared ──────────────────────────────────────────────────────────────────

/**
 * Open the config, warn about unknown top-level keys, run `body`, and map
 * errors / cancellation to exit codes. A missing or invalid config exits 2.
 */
async function guarded<R extends EditRole>(
  ctx: CliContext,
  role: R,
  cancelledMessage: string,
  body: (handle: EditHandle<R>) => Promise<number>,
): Promise<number> {
  let handle: EditHandle<R>;
  try {
    handle = await openConfigForEdit(ctx.repoRoot.path, role);
  } catch (err) {
    if (err instanceof ConfigError) {
      ctx.logger.error(err.message);
      return EXIT_REFUSED;
    }
    throw err;
  }
  for (const key of handle.unknownKeys) {
    ctx.prompts.log.warning(
      `Unrecognized top-level field '${key}' in ${handle.filePath} — kept as is.`,
    );
  }
  try {
    return await body(handle);
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      if (cancelledMessage) ctx.prompts.outro(cancelledMessage);
      return EXIT_INTERRUPTED;
    }
    if (err instanceof ConfigError) {
      ctx.logger.error(err.message);
      return EXIT_REFUSED;
    }
    throw err;
  }
}

function declined(ctx: CliContext, file: string): number {
  ctx.prompts.outro(`Cancelled — ${file} not modified.`);
  return EXIT_DECLINED;
}

function countLine(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
