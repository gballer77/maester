import { globby } from "globby";
import { isMap, isSeq } from "yaml";
import { ZodError, z } from "zod";
import { PublishedDocumentSchema } from "../../schemas/maester.js";
import type { PublishedDocument } from "../../schemas/maester.js";
import {
  type EditHandle,
  appendEntry,
  removeEntry,
  updateEntry,
  validateEdit,
} from "../config/edit.js";
import { ConfigError } from "../errors.js";
import { matchSensitive } from "./sensitive.js";

/**
 * The one write path for agent-driven manifest edits (architecture §6.19,
 * Gaps 76–78, 80). `publish apply` sends a whole approved proposal; the flag
 * verbs (`publish add | update | remove --path`) send a one-item set.
 */
export const UNSETTABLE_FIELDS = ["description", "category", "tags", "state"] as const;
export type UnsettableField = (typeof UNSETTABLE_FIELDS)[number];

const UpdateSchema = z
  .object({
    path: z.string().min(1),
    set: PublishedDocumentSchema.omit({ path: true }).partial().optional(),
    unset: z.array(z.enum(UNSETTABLE_FIELDS)).optional(),
  })
  .strict();

export const ChangeSetSchema = z
  .object({
    add: z.array(PublishedDocumentSchema).optional(),
    update: z.array(UpdateSchema).optional(),
    remove: z.array(z.string().min(1)).optional(),
    acknowledgeNarrowing: z.boolean().optional(),
    allowSensitive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (s) => (s.add?.length ?? 0) + (s.update?.length ?? 0) + (s.remove?.length ?? 0) > 0,
    "a change set needs at least one add, update or remove",
  );

export type ChangeSet = z.infer<typeof ChangeSetSchema>;

/** A refused or invalid change set. `field` names what to fix (`add.0.category`, `remove`, …). */
export class ChangeSetError extends Error {
  readonly field: string;
  readonly path: string | undefined;
  constructor(field: string, message: string, path?: string) {
    super(message);
    this.name = "ChangeSetError";
    this.field = field;
    this.path = path;
  }
}

export type ChangeSetResult = {
  added: string[];
  updated: string[];
  removed: string[];
  documents: PublishedDocument[];
};

/** Parse untrusted JSON text into a `ChangeSet`, mapping problems to `ChangeSetError`. */
export function parseChangeSet(text: string): ChangeSet {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ChangeSetError("", `change set is not valid JSON (${(err as Error).message})`);
  }
  const result = ChangeSetSchema.safeParse(raw);
  if (result.success) return result.data;
  throw fromZod(result.error);
}

/**
 * Apply `set` to the manifest held by `handle`, in memory: remove → update →
 * add, entries keyed by exact `path`. The guards and a full schema validation
 * run before returning, so the caller only has to `commitEdit()` — or not,
 * for a dry run. `existed` is false when the handle came from
 * `createConfigForEdit()` (no manifest on disk).
 */
export async function applyChangeSet(
  handle: EditHandle<"maester">,
  set: ChangeSet,
  options: { repoRoot: string; existed: boolean },
): Promise<ChangeSetResult> {
  const before = handle.config.documents ?? [];
  const publishedWholeRepo = !options.existed || before.length === 0;

  for (const path of set.remove ?? []) {
    const index = indexOfPath(handle, path);
    if (index < 0) throw new ChangeSetError("remove", `no entry with path '${path}'`, path);
    removeEntry(handle, index);
  }

  for (const [i, update] of (set.update ?? []).entries()) {
    const index = indexOfPath(handle, update.path);
    if (index < 0) {
      throw new ChangeSetError(
        `update.${i}.path`,
        `no entry with path '${update.path}'`,
        update.path,
      );
    }
    const setFields = update.set ?? {};
    const unset = update.unset ?? [];
    const both = unset.filter((k) => setFields[k] !== undefined);
    if (both.length > 0) {
      throw new ChangeSetError(
        `update.${i}`,
        `'${both[0]}' is both set and unset for '${update.path}'`,
        update.path,
      );
    }
    if (Object.keys(setFields).length === 0 && unset.length === 0) {
      throw new ChangeSetError(
        `update.${i}`,
        `nothing to change for '${update.path}'`,
        update.path,
      );
    }
    updateEntry(handle, index, setFields, unset);
  }

  for (const [i, doc] of (set.add ?? []).entries()) {
    if (indexOfPath(handle, doc.path) >= 0) {
      throw new ChangeSetError(
        `add.${i}.path`,
        `an entry with path '${doc.path}' already exists`,
        doc.path,
      );
    }
    appendEntry(handle, doc);
  }

  let after: PublishedDocument[];
  try {
    after = validateEdit(handle).documents ?? [];
  } catch (err) {
    if (err instanceof ConfigError && err.cause instanceof ZodError) throw fromZod(err.cause);
    throw err;
  }

  if (before.length > 0 && after.length === 0) {
    throw new ChangeSetError(
      "remove",
      "this would remove every entry, and an empty `documents` list publishes the WHOLE repository. Keep at least one entry, or edit maester.yaml by hand to opt into whole-repository publishing.",
    );
  }
  if (publishedWholeRepo && after.length > 0 && set.acknowledgeNarrowing !== true) {
    throw new ChangeSetError(
      "acknowledgeNarrowing",
      `${options.existed ? "This manifest" : "With no maester.yaml, this repository"} publishes the WHOLE repository; after this change it publishes only the listed documents. Set acknowledgeNarrowing (--acknowledge-narrowing) to confirm.`,
    );
  }
  if (set.allowSensitive !== true) {
    for (const [i, doc] of (set.add ?? []).entries()) {
      const hit = await findSensitive(options.repoRoot, doc.path);
      if (hit) {
        throw new ChangeSetError(
          `add.${i}.path`,
          `'${doc.path}' would publish ${hit.file} (${hit.reason}). Leave it out, or set allowSensitive (--allow-sensitive) if publishing it is intended.`,
          doc.path,
        );
      }
    }
  }

  return {
    added: (set.add ?? []).map((d) => d.path),
    updated: (set.update ?? []).map((u) => u.path),
    removed: [...(set.remove ?? [])],
    documents: after,
  };
}

function indexOfPath(handle: EditHandle<"maester">, path: string): number {
  const seq = handle.doc.get("documents", true);
  if (!isSeq(seq)) return -1;
  return seq.items.findIndex((item) => isMap(item) && item.get("path") === path);
}

/** A literal sensitive path, or a glob that resolves to one in the working tree. */
async function findSensitive(
  repoRoot: string,
  pattern: string,
): Promise<{ file: string; reason: string } | undefined> {
  const literal = matchSensitive(pattern);
  if (literal) return { file: pattern, reason: literal };
  const files = await globby(pattern, {
    cwd: repoRoot,
    // Same options as manifest resolution at sync time, so only files that
    // would really be published count.
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    gitignore: false,
    ignore: ["**/.git/**", "**/node_modules/**"],
  });
  for (const file of files.sort()) {
    const reason = matchSensitive(file);
    if (reason) return { file, reason };
  }
  return undefined;
}

function fromZod(error: ZodError): ChangeSetError {
  const issue = error.issues[0];
  const field = issue?.path.join(".") ?? "";
  return new ChangeSetError(field, issue?.message ?? "invalid change set");
}
