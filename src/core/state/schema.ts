import { z } from "zod";

export const STATE_VALUES = ["draft", "canon"] as const;
export const StateSchema = z.enum(STATE_VALUES);
export type State = z.infer<typeof StateSchema>;

export const DEFAULT_STATE: State = "draft";

/** Lowercase kebab-case slug: names, categories, tags. Re-exported by the config schemas. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export const CategorySchema = z
  .string()
  .min(1)
  .regex(SLUG_RE, "category must be a lowercase kebab-case slug (e.g. spec, api-reference)");

export const TagsSchema = z.array(
  z
    .string()
    .min(1)
    .regex(SLUG_RE, "each tag must be a lowercase kebab-case slug (e.g. public, api)"),
);

export type ParseResult<T> =
  | { kind: "valid"; value: T }
  | { kind: "invalid"; raw: string }
  | { kind: "absent" };

export type ParseStateResult = ParseResult<State>;

/** One file's inline metadata as read; every field is always present (possibly `absent`). */
export type InlineMetadataRead = {
  state: ParseResult<State>;
  category: ParseResult<string>;
  tags: ParseResult<string[]>;
};

/** Resolved values to write. An unset `category` / `tags` leaves the file's value alone. */
export type InlineMetadataWrite = {
  state: State;
  category?: string;
  tags?: readonly string[];
};

export const METADATA_KEYS = ["state", "category", "tags"] as const;
export type MetadataKey = (typeof METADATA_KEYS)[number];

export const ABSENT_METADATA: InlineMetadataRead = {
  state: { kind: "absent" },
  category: { kind: "absent" },
  tags: { kind: "absent" },
};

export type RuleEntry = {
  pattern: string;
  state?: State;
  category?: string;
  tags?: readonly string[];
};

export function parseState(value: unknown): ParseStateResult {
  if (value === undefined || value === null) return { kind: "absent" };
  const raw = typeof value === "string" ? value : String(value);
  if (raw.length === 0) return { kind: "absent" };
  const result = StateSchema.safeParse(raw);
  if (result.success) return { kind: "valid", value: result.data };
  return { kind: "invalid", raw };
}

export function parseCategory(value: unknown): ParseResult<string> {
  if (value === undefined || value === null) return { kind: "absent" };
  const raw = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (raw.length === 0) return { kind: "absent" };
  if (typeof value === "string" && SLUG_RE.test(raw)) return { kind: "valid", value: raw };
  return { kind: "invalid", raw };
}

/**
 * Tags arrive as a sequence (markdown / YAML / JSON) or a comma-separated
 * string (HTML / plain text). Any empty or non-slug item makes the whole value
 * invalid; duplicates are dropped after their first occurrence.
 */
export function parseTags(value: unknown): ParseResult<string[]> {
  if (value === undefined || value === null) return { kind: "absent" };
  let items: unknown[];
  let raw: string;
  if (typeof value === "string") {
    raw = value.trim();
    if (raw.length === 0) return { kind: "absent" };
    items = raw.split(",").map((item) => item.trim());
  } else if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "absent" };
    items = value;
    raw = value.map((item) => String(item)).join(", ");
  } else {
    return { kind: "invalid", raw: JSON.stringify(value) };
  }
  const tags: string[] = [];
  for (const item of items) {
    if (typeof item !== "string" || !SLUG_RE.test(item)) return { kind: "invalid", raw };
    if (!tags.includes(item)) tags.push(item);
  }
  return { kind: "valid", value: tags };
}

/** Read the three fields from a key/value document (frontmatter, YAML map, JSON object). */
export function readMetadataFields(data: Record<string, unknown>): InlineMetadataRead {
  return {
    state: parseState(data.state),
    category: parseCategory(data.category),
    tags: parseTags(data.tags),
  };
}

/**
 * The key/value changes needed to bring `data` to `resolved`, in the fixed
 * order state → category → tags. Empty when nothing differs.
 */
export function metadataChanges(
  data: Record<string, unknown>,
  resolved: InlineMetadataWrite,
): [MetadataKey, string | string[]][] {
  const changes: [MetadataKey, string | string[]][] = [];
  if (data.state !== resolved.state) changes.push(["state", resolved.state]);
  if (resolved.category !== undefined && data.category !== resolved.category) {
    changes.push(["category", resolved.category]);
  }
  if (resolved.tags !== undefined && !sameTags(data.tags, resolved.tags)) {
    changes.push(["tags", [...resolved.tags]]);
  }
  return changes;
}

function sameTags(existing: unknown, tags: readonly string[]): boolean {
  return (
    Array.isArray(existing) &&
    existing.length === tags.length &&
    existing.every((tag, i) => tag === tags[i])
  );
}
