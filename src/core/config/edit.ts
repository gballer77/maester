import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type Document, YAMLSeq, isMap, isSeq, parseDocument } from "yaml";
import { z } from "zod";
import { type CitadelConfig, CitadelConfigSchema } from "../../schemas/citadel.js";
import { type MaesterConfig, MaesterConfigSchema } from "../../schemas/maester.js";
import { ConfigError } from "../errors.js";
import { citadelConfigPath, maesterConfigPath } from "./paths.js";
import { MAESTER_HEADER } from "./writer.js";

/**
 * Config editing (architecture §6.18): append or remove one entry by editing
 * the parsed YAML Document in place, so comments, key order, `schemaVersion`
 * and every untouched field survive. The whole result is re-validated before
 * an atomic write.
 */
export type EditRole = "citadel" | "maester";

type RoleSpec<T> = {
  schema: z.ZodType<T>;
  path: (repoRoot: string) => string;
  /** The sequence `add` / `remove` operate on. */
  listKey: "sources" | "documents";
  missingHint: string;
};

const ROLES: { citadel: RoleSpec<CitadelConfig>; maester: RoleSpec<MaesterConfig> } = {
  citadel: {
    schema: CitadelConfigSchema as unknown as z.ZodType<CitadelConfig>,
    path: citadelConfigPath,
    listKey: "sources",
    missingHint: "No citadel.yaml found here. Run `maester init` to create one.",
  },
  maester: {
    schema: MaesterConfigSchema as unknown as z.ZodType<MaesterConfig>,
    path: maesterConfigPath,
    listKey: "documents",
    missingHint: "No maester.yaml found here. Run `maester publish` to create one.",
  },
};

type ConfigFor<R extends EditRole> = R extends "citadel" ? CitadelConfig : MaesterConfig;

export type EditHandle<R extends EditRole> = {
  role: R;
  filePath: string;
  doc: Document;
  /** The validated config as currently on disk. */
  config: ConfigFor<R>;
  /** Top-level keys the schema does not know; kept on write, warned about. */
  unknownKeys: string[];
};

export async function openConfigForEdit<R extends EditRole>(
  repoRoot: string,
  role: R,
): Promise<EditHandle<R>> {
  const spec = ROLES[role] as RoleSpec<ConfigFor<R>>;
  const filePath = spec.path(repoRoot);
  if (!existsSync(filePath)) throw new ConfigError(spec.missingHint, { filePath });
  const raw = await readFile(filePath, "utf8");
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new ConfigError(`${filePath}: YAML parse error: ${doc.errors[0]?.message}`, {
      filePath,
    });
  }
  if (!isMap(doc.contents)) {
    throw new ConfigError(`${filePath}: expected a mapping at the top level`, { filePath });
  }
  const known = new Set(Object.keys(objectShape(spec.schema)));
  const unknownKeys = doc.contents.items
    .map((pair) => String((pair.key as { value?: unknown })?.value ?? pair.key))
    .filter((key) => !known.has(key));
  const config = validate(doc, spec.schema, unknownKeys, filePath);
  return { role, filePath, doc, config, unknownKeys };
}

/**
 * A handle on a manifest that does not exist yet (architecture §6.19, Gap 78):
 * the standard header comment, `schemaVersion: 1` and an empty `documents`
 * list. The first `commitEdit()` creates the file atomically.
 */
export function createConfigForEdit(repoRoot: string, role: "maester"): EditHandle<"maester"> {
  const spec = ROLES[role];
  const filePath = spec.path(repoRoot);
  const doc = parseDocument(`${MAESTER_HEADER}schemaVersion: 1\ndocuments: []\n`);
  const config = validate(doc, spec.schema, [], filePath);
  return { role, filePath, doc, config, unknownKeys: [] };
}

/** Append `value` to the role's list (`sources` / `documents`), creating it if absent. */
export function appendEntry<R extends EditRole>(handle: EditHandle<R>, value: unknown): void {
  const key = ROLES[handle.role].listKey;
  const node = handle.doc.createNode(value);
  const seq = handle.doc.get(key, true);
  if (isSeq(seq)) {
    // `documents: []` is a flow sequence; grow it as a block list instead.
    if (seq.items.length === 0) seq.flow = false;
    seq.add(node);
    return;
  }
  const fresh = new YAMLSeq();
  fresh.add(node);
  handle.doc.set(key, fresh);
}

/** Remove the item at `index` from the role's list. */
export function removeEntry<R extends EditRole>(handle: EditHandle<R>, index: number): void {
  const seq = handle.doc.get(ROLES[handle.role].listKey, true);
  if (!isSeq(seq) || index < 0 || index >= seq.items.length) {
    throw new Error(`no entry at index ${index}`);
  }
  seq.delete(index);
}

/**
 * Set and clear fields of the entry at `index` in place (§6.19). The entry's
 * other keys, their order and comments are untouched; a replaced sequence
 * keeps the flow / block style of the value it replaces.
 */
export function updateEntry<R extends EditRole>(
  handle: EditHandle<R>,
  index: number,
  set: Readonly<Record<string, unknown>>,
  unset: readonly string[] = [],
): void {
  const seq = handle.doc.get(ROLES[handle.role].listKey, true);
  const entry = isSeq(seq) ? seq.items[index] : undefined;
  if (!isMap(entry)) throw new Error(`no entry at index ${index}`);
  for (const [key, value] of Object.entries(set)) {
    if (value === undefined) continue;
    const previous = entry.get(key, true);
    const node = handle.doc.createNode(value);
    if (isSeq(previous) && isSeq(node)) node.flow = previous.flow === true;
    entry.set(key, node);
  }
  for (const key of unset) entry.delete(key);
}

/** Validate the edited document without writing; throws `ConfigError` like `commitEdit`. */
export function validateEdit<R extends EditRole>(handle: EditHandle<R>): ConfigFor<R> {
  const spec = ROLES[handle.role] as RoleSpec<ConfigFor<R>>;
  return validate(handle.doc, spec.schema, handle.unknownKeys, handle.filePath);
}

/**
 * Re-validate the edited document and replace the file atomically: write a
 * sibling temp file, fsync, rename over the target. Any failure leaves the
 * original untouched and removes the temp file.
 */
export async function commitEdit<R extends EditRole>(handle: EditHandle<R>): Promise<ConfigFor<R>> {
  const config = validateEdit(handle);
  // No padding inside flow collections: `[a, b]` round-trips as written (P2, best-effort).
  await writeFileAtomic(handle.filePath, handle.doc.toString({ flowCollectionPadding: false }));
  return config;
}

export async function writeFileAtomic(filePath: string, text: string): Promise<void> {
  const tmp = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    const handle = await open(tmp, "wx");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, filePath);
  } catch (err) {
    await rm(tmp, { force: true });
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Could not write ${filePath}; the original is unchanged (${reason}).`, {
      filePath,
      cause: err,
    });
  }
}

function validate<T>(
  doc: Document,
  schema: z.ZodType<T>,
  unknownKeys: readonly string[],
  filePath: string,
): T {
  const data = doc.toJS({ maxAliasCount: -1 }) as Record<string, unknown>;
  for (const key of unknownKeys) delete data[key];
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path?.length ? ` at \`${issue.path.join(".")}\`` : "";
  throw new ConfigError(`${filePath}: ${issue?.message ?? "validation failed"}${where}`, {
    filePath,
    cause: result.error,
  });
}

/** The object shape behind a (possibly refined) zod object schema. */
function objectShape(schema: z.ZodTypeAny): z.ZodRawShape {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) current = current.innerType();
  return current instanceof z.ZodObject ? current.shape : {};
}
