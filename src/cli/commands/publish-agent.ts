import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  type EditHandle,
  commitEdit,
  createConfigForEdit,
  openConfigForEdit,
} from "../../core/config/edit.js";
import { maesterConfigPath } from "../../core/config/paths.js";
import { ConfigError } from "../../core/errors.js";
import {
  type ChangeSet,
  ChangeSetError,
  type ChangeSetResult,
  UNSETTABLE_FIELDS,
  type UnsettableField,
  applyChangeSet,
  parseChangeSet,
} from "../../core/publisher/change-set.js";
import { DEFAULT_INVENTORY_LIMIT, runInventory } from "../../core/publisher/inventory.js";
import { type PreviewReport, runPreview } from "../../core/publisher/preview.js";
import type { PublishedDocument } from "../../schemas/maester.js";
import { renderTable } from "../../ui/components/table.js";
import type { CliContext } from "../context.js";

/**
 * Non-interactive manifest verbs for coding agents (architecture §6.19):
 * `publish apply | update` plus the `--path` modes of `publish add | remove`.
 * None of them prompt — confirmation happens in the agent conversation, and
 * every write goes through `applyChangeSet()`.
 */
const EXIT_OK = 0;
const EXIT_REFUSED = 2;

export type WriteFlags = {
  create?: boolean;
  dryRun?: boolean;
  acknowledgeNarrowing?: boolean;
  allowSensitive?: boolean;
};

export type FieldFlags = {
  description?: string;
  category?: string;
  tags?: string;
  state?: string;
};

export function registerPublishAgent(publish: Command, getContext: () => CliContext): void {
  publish
    .command("apply")
    .description(
      "Apply a change set ({ add, update, remove } JSON on stdin or --from) to maester.yaml in one validated, atomic edit. Never prompts.",
    )
    .option("--from <file>", "Read the change set from a file ('-' for stdin).")
    .option("--create", "Create maester.yaml when it does not exist.")
    .option("--dry-run", "Validate and print the result without writing.")
    .action(async (options: WriteFlags & { from?: string }) => {
      process.exitCode = await runApply(getContext(), options);
    });

  withWriteFlags(
    withFieldFlags(
      publish
        .command("update")
        .description("Update one published document in place, without prompts.")
        .requiredOption("--path <path>", "The entry's path, exactly as written in maester.yaml.")
        .option(
          "--unset <field>",
          `Clear a field (repeatable): ${UNSETTABLE_FIELDS.join(", ")}.`,
          (value: string, prev: string[]) => [...prev, value],
          [] as string[],
        ),
    ),
  ).action(async (options: WriteFlags & FieldFlags & { path: string; unset: string[] }) => {
    process.exitCode = await runFlagUpdate(getContext(), options);
  });

  publish
    .command("inventory")
    .description(
      "Read-only: list candidate documents, their inline metadata, which entry covers each, the vocabulary in use and likely-sensitive files. Never prints file contents.",
    )
    .option("--all", "List every non-excluded file, not only documentation.")
    .option(
      "--limit <n>",
      `Cap the file list (default ${DEFAULT_INVENTORY_LIMIT}); the rollup stays complete.`,
      (v: string) => Number.parseInt(v, 10),
    )
    .action(async (options: { all?: boolean; limit?: number }) => {
      process.exitCode = await runInventoryCommand(getContext(), options);
    });

  publish
    .command("preview")
    .description(
      "Read-only: the files each entry would publish, with effective state / category / tags. With --from, previews a change set applied in memory.",
    )
    .option("--from <file>", "Preview a change set (JSON file, or '-' for stdin).")
    .action(async (options: { from?: string }) => {
      process.exitCode = await runPreviewCommand(getContext(), options);
    });
}

/** Options shared by `publish add --path …` and `publish update`. */
export function withFieldFlags(command: Command): Command {
  return command
    .option("--description <text>", "One-line description.")
    .option("--category <slug>", "Category slug.")
    .option("--tags <a,b>", "Comma-separated tag slugs.")
    .option("--state <state>", "canon or draft (omit for 'file header').");
}

export function withWriteFlags(command: Command): Command {
  return command
    .option("--dry-run", "Validate and print the result without writing.")
    .option(
      "--acknowledge-narrowing",
      "Confirm that a whole-repository manifest becomes a list of documents.",
    )
    .option("--allow-sensitive", "Allow an entry that matches a likely-sensitive path.");
}

export async function runApply(
  ctx: CliContext,
  options: WriteFlags & { from?: string },
): Promise<number> {
  let text: string;
  try {
    text = await readChangeSetText(options.from);
  } catch (err) {
    return fail(ctx, new ChangeSetError("", (err as Error).message));
  }
  let set: ChangeSet;
  try {
    set = parseChangeSet(text);
  } catch (err) {
    return fail(ctx, err);
  }
  return runChangeSet(ctx, set, options);
}

export async function runFlagAdd(
  ctx: CliContext,
  options: WriteFlags & FieldFlags & { path: string },
): Promise<number> {
  let doc: PublishedDocument;
  try {
    doc = { path: options.path, ...fieldsFromFlags(options) } as PublishedDocument;
  } catch (err) {
    return fail(ctx, err);
  }
  return runChangeSet(ctx, { add: [doc], ...guardFlags(options) }, options);
}

export async function runFlagRemove(
  ctx: CliContext,
  options: WriteFlags & { path: string },
): Promise<number> {
  return runChangeSet(ctx, { remove: [options.path] }, options);
}

export async function runFlagUpdate(
  ctx: CliContext,
  options: WriteFlags & FieldFlags & { path: string; unset: string[] },
): Promise<number> {
  const bad = options.unset.find((f) => !(UNSETTABLE_FIELDS as readonly string[]).includes(f));
  if (bad !== undefined) {
    return fail(
      ctx,
      new ChangeSetError(
        "unset",
        `cannot unset '${bad}'; use one of ${UNSETTABLE_FIELDS.join(", ")}`,
      ),
    );
  }
  const set = fieldsFromFlags(options);
  return runChangeSet(
    ctx,
    {
      update: [
        {
          path: options.path,
          ...(Object.keys(set).length > 0 ? { set } : {}),
          ...(options.unset.length > 0 ? { unset: options.unset as UnsettableField[] } : {}),
        },
      ],
      ...guardFlags(options),
    },
    options,
  );
}

/**
 * Open (or, with `create`, start) the manifest, apply `set` in memory, then
 * commit unless this is a dry run. Field-specific errors exit 2 and leave
 * the file untouched.
 */
async function runChangeSet(ctx: CliContext, set: ChangeSet, options: WriteFlags): Promise<number> {
  const repoRoot = ctx.repoRoot.path;
  const existed = existsSync(maesterConfigPath(repoRoot));
  let handle: EditHandle<"maester">;
  try {
    if (existed) {
      handle = await openConfigForEdit(repoRoot, "maester");
    } else if (options.create === true) {
      handle = createConfigForEdit(repoRoot, "maester");
    } else {
      return fail(
        ctx,
        new ChangeSetError(
          "",
          "No maester.yaml found here. Pass --create to create it, or run `maester publish`.",
        ),
      );
    }
    const result = await applyChangeSet(handle, set, { repoRoot, existed });
    if (options.dryRun !== true) await commitEdit(handle);
    report(ctx, result, {
      filePath: handle.filePath,
      created: !existed && options.dryRun !== true,
      dryRun: options.dryRun === true,
    });
    return EXIT_OK;
  } catch (err) {
    return fail(ctx, err);
  }
}

export async function runInventoryCommand(
  ctx: CliContext,
  options: { all?: boolean; limit?: number },
): Promise<number> {
  if (options.limit !== undefined && !(Number.isInteger(options.limit) && options.limit > 0)) {
    ctx.logger.error("--limit must be a positive integer.");
    return EXIT_REFUSED;
  }
  let report: Awaited<ReturnType<typeof runInventory>>;
  try {
    report = await runInventory(ctx.repoRoot.path, {
      ...(options.all === true ? { all: true } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      ctx.logger.error(err.message);
      return EXIT_REFUSED;
    }
    throw err;
  }
  if (ctx.flags.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return EXIT_OK;
  }
  const manifestLine = {
    none: "No maester.yaml — citadels treat this repository as publishing everything.",
    "whole-repository": "maester.yaml lists no documents — the whole repository is published.",
    listed: "maester.yaml lists documents; uncovered files below are not published.",
  }[report.manifest];
  process.stdout.write(`${manifestLine}\n`);
  if (report.directories.length > 0) {
    process.stdout.write(
      `${renderTable(ctx.theming, {
        columns: [
          { header: "Directory", key: "dir" },
          { header: "Docs", key: "docs" },
          { header: "Uncovered", key: "uncovered" },
        ],
        rows: report.directories.map((d) => ({
          dir: d.dir,
          docs: String(d.docFiles),
          uncovered: String(d.uncovered),
        })),
      })}\n`,
    );
  }
  const vocab = (r: Record<string, number>) =>
    Object.entries(r)
      .map(([k, n]) => `${k} (${n})`)
      .join(", ") || "(none)";
  process.stdout.write(`Categories in use: ${vocab(report.vocabulary.categories)}\n`);
  process.stdout.write(`Tags in use: ${vocab(report.vocabulary.tags)}\n`);
  if (report.sensitive.length > 0) {
    process.stdout.write("Likely sensitive — never publish:\n");
    for (const s of report.sensitive) process.stdout.write(`  ! ${s.path} (${s.reason})\n`);
  }
  process.stdout.write(
    `${report.files.length} file${report.files.length === 1 ? "" : "s"}${report.truncated ? " (truncated — raise --limit)" : ""}. Use --json for per-file detail.\n`,
  );
  return EXIT_OK;
}

const PREVIEW_FILES_PER_ENTRY = 20;

export async function runPreviewCommand(
  ctx: CliContext,
  options: { from?: string },
): Promise<number> {
  const repoRoot = ctx.repoRoot.path;
  const existed = existsSync(maesterConfigPath(repoRoot));
  let documents: PublishedDocument[] | undefined;
  try {
    if (options.from !== undefined) {
      const set = parseChangeSet(await readChangeSetText(options.from));
      const handle = existed
        ? await openConfigForEdit(repoRoot, "maester")
        : createConfigForEdit(repoRoot, "maester");
      documents = (await applyChangeSet(handle, set, { repoRoot, existed })).documents;
    } else if (existed) {
      documents = (await openConfigForEdit(repoRoot, "maester")).config.documents ?? [];
    }
  } catch (err) {
    return fail(ctx, err);
  }
  const report = await runPreview(repoRoot, documents);
  if (ctx.flags.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(formatPreview(report));
  }
  return EXIT_OK;
}

function formatPreview(report: PreviewReport): string {
  const lines: string[] = [];
  if (report.manifest !== "listed") {
    lines.push(
      report.manifest === "none"
        ? "No maester.yaml — citadels publish the whole repository:"
        : "maester.yaml lists no documents — the whole repository is published:",
    );
    for (const d of report.directories) lines.push(`  ${d.dir}  (${d.files})`);
    lines.push(`${report.totalFiles} files.`);
    return `${lines.join("\n")}\n`;
  }
  for (const entry of report.entries) {
    const flags = entry.flags.length > 0 ? `  [${entry.flags.join(", ")}]` : "";
    lines.push(
      `${entry.path} — ${entry.files.length} file${entry.files.length === 1 ? "" : "s"}${flags}`,
    );
    for (const f of entry.files.slice(0, PREVIEW_FILES_PER_ENTRY)) {
      const meta = [
        f.state === "untagged" ? "untagged" : `${f.state} (${f.stateSource})`,
        ...(f.category ? [`category ${f.category} (${f.categorySource})`] : []),
        ...(f.tags ? [`tags ${f.tags.join(",")} (${f.tagsSource})`] : []),
        ...(f.multiMatch
          ? [`also matched by ${f.multiMatch.filter((p) => p !== entry.path).join(", ")}`]
          : []),
      ];
      lines.push(`  ${f.path}  ${meta.join(" · ")}`);
    }
    if (entry.files.length > PREVIEW_FILES_PER_ENTRY) {
      lines.push(`  … and ${entry.files.length - PREVIEW_FILES_PER_ENTRY} more (use --json)`);
    }
  }
  lines.push(`${report.totalFiles} files published in total.`);
  return `${lines.join("\n")}\n`;
}

function fieldsFromFlags(flags: FieldFlags): Partial<Omit<PublishedDocument, "path">> {
  const out: Record<string, unknown> = {};
  if (flags.description !== undefined) out.description = flags.description;
  if (flags.category !== undefined) out.category = flags.category;
  if (flags.tags !== undefined) {
    out.tags = flags.tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }
  if (flags.state !== undefined) out.state = flags.state;
  return out as Partial<Omit<PublishedDocument, "path">>;
}

function guardFlags(flags: WriteFlags): Pick<ChangeSet, "acknowledgeNarrowing" | "allowSensitive"> {
  return {
    ...(flags.acknowledgeNarrowing === true ? { acknowledgeNarrowing: true } : {}),
    ...(flags.allowSensitive === true ? { allowSensitive: true } : {}),
  };
}

async function readChangeSetText(from: string | undefined): Promise<string> {
  if (from !== undefined && from !== "-") return readFile(from, "utf8");
  if (process.stdin.isTTY) {
    throw new Error("Pass the change set as JSON on stdin, or with --from <file>.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function report(
  ctx: CliContext,
  result: ChangeSetResult,
  meta: { filePath: string; created: boolean; dryRun: boolean },
): void {
  if (ctx.flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...meta, ...result })}\n`);
    return;
  }
  for (const p of result.removed) process.stdout.write(`- ${p}\n`);
  for (const p of result.updated) process.stdout.write(`~ ${p}\n`);
  for (const p of result.added) process.stdout.write(`+ ${p}\n`);
  const count = `${result.documents.length} document${result.documents.length === 1 ? "" : "s"}`;
  process.stdout.write(
    meta.dryRun
      ? `Dry run — nothing written. ${meta.filePath} would list ${count}.\n`
      : `${meta.created ? "Created" : "Updated"} ${meta.filePath} (${count}).\n`,
  );
}

function fail(ctx: CliContext, err: unknown): number {
  const error =
    err instanceof ChangeSetError
      ? {
          field: err.field,
          ...(err.path !== undefined ? { path: err.path } : {}),
          message: err.message,
        }
      : err instanceof ConfigError
        ? { field: "", message: err.message }
        : undefined;
  if (!error) throw err;
  if (ctx.flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
  } else {
    ctx.logger.error(error.field ? `${error.field}: ${error.message}` : error.message);
  }
  return EXIT_REFUSED;
}
