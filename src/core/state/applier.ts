import type { Dirent } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import picomatch from "picomatch";
import { handlerFor } from "./format.js";
import {
  DEFAULT_STATE,
  type InlineMetadataRead,
  type InlineMetadataWrite,
  type ParseResult,
  type RuleEntry,
  type State,
} from "./schema.js";

export type SourceOfTruth = "inline" | "rule" | "default";
/** Category and tags have no default: an unresolved field is `unset`. */
export type FieldSourceOfTruth = "inline" | "rule" | "unset";

export type StateBreakdown = {
  canon: number;
  draft: number;
  untagged: number;
};

/** Files per resolved category; unsupported formats and unset categories are `unclassified`. */
export type CategoryBreakdown = {
  byCategory: Record<string, number>;
  unclassified: number;
};

/** Files carrying each tag; files with no resolved tags are `untagged`. */
export type TagRollup = {
  byTag: Record<string, number>;
  untagged: number;
};

export type BadInlineStateWarning = { type: "bad-inline-state"; file: string; raw: string };
export type BadInlineCategoryWarning = { type: "bad-inline-category"; file: string; raw: string };
export type BadInlineTagsWarning = { type: "bad-inline-tags"; file: string; raw: string };

export type DisagreementWarning =
  | { type: "disagreement"; file: string; field: "state"; inline: State; rule: State }
  | { type: "disagreement"; file: string; field: "category"; inline: string; rule: string }
  | { type: "disagreement"; file: string; field: "tags"; inline: string[]; rule: string[] };

export type MetadataWarning =
  | BadInlineStateWarning
  | BadInlineCategoryWarning
  | BadInlineTagsWarning
  | DisagreementWarning;

/** Historical name; the union now covers all three inline fields. */
export type StateWarning = MetadataWarning;

export type StateApplyDetail = {
  file: string;
  state: State | "untagged";
  sourceOfTruth: SourceOfTruth | "untagged";
  category?: string;
  categorySource: FieldSourceOfTruth | "untagged";
  tags?: string[];
  tagsSource: FieldSourceOfTruth | "untagged";
};

export type StateApplyResult = {
  breakdown: StateBreakdown;
  categoryBreakdown: CategoryBreakdown;
  tagRollup: TagRollup;
  warnings: MetadataWarning[];
  details: StateApplyDetail[];
};

const MATCHER_OPTIONS = { dot: false, nocase: false } as const;

export type CompiledRule = { rule: RuleEntry; match: (p: string) => boolean };

export function compileRules(rules: readonly RuleEntry[]): CompiledRule[] {
  return rules.map((rule) => ({ rule, match: picomatch(rule.pattern, MATCHER_OPTIONS) }));
}

/** `state` keeps Gap 21's rule: the first matching entry decides, even when it sets no state. */
function findRuleState(filePath: string, rules: readonly CompiledRule[]): State | undefined {
  return rules.find((r) => r.match(filePath))?.rule.state;
}

/** Category and tags take the first matching entry that sets that field (Gap 70). */
function findRuleField<K extends "category" | "tags">(
  filePath: string,
  rules: readonly CompiledRule[],
  field: K,
): RuleEntry[K] | undefined {
  for (const { rule, match } of rules) {
    if (rule[field] !== undefined && match(filePath)) return rule[field];
  }
  return undefined;
}

async function* walk(dir: string, root: string): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true, encoding: "utf8" })) as Dirent[];
  } catch {
    return;
  }
  const isRoot = dir === root;
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    if (entry.name === ".maester-source.json") continue;
    // The remote's maester.yaml is fetched as part of the sparse checkout so
    // that the citadel can see the source's declared publish surface, but it
    // is the manifest itself — a sync artifact, not a published document.
    // Skipping it at the destination root keeps the breakdown honest and
    // avoids injecting a state tag into a config file.
    if (isRoot && entry.name === "maester.yaml") continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, root);
    } else if (entry.isFile()) {
      yield relative(root, full);
    }
  }
}

export type Resolved<T> = { value: T | undefined; source: FieldSourceOfTruth };

export type ResolvedFileMetadata = {
  state: State;
  sourceOfTruth: SourceOfTruth;
  category: Resolved<string>;
  tags: Resolved<string[]>;
  warnings: MetadataWarning[];
};

/**
 * Resolve one file's `state`, `category` and `tags` from its inline values
 * and the compiled rules — pure, no I/O. Shared by sync (which then writes
 * the result into the file) and `maester publish preview` (§6.19, Gap 82),
 * so the two cannot disagree.
 */
export function resolveFileMetadata(
  relPath: string,
  inline: InlineMetadataRead,
  compiled: readonly CompiledRule[],
): ResolvedFileMetadata {
  const warnings: MetadataWarning[] = [];
  let state: State;
  let sourceOfTruth: SourceOfTruth;
  const ruleState = findRuleState(relPath, compiled);
  if (inline.state.kind === "valid") {
    state = inline.state.value;
    sourceOfTruth = "inline";
    if (ruleState !== undefined && ruleState !== state) {
      warnings.push({
        type: "disagreement",
        file: relPath,
        field: "state",
        inline: state,
        rule: ruleState,
      });
    }
  } else {
    if (inline.state.kind === "invalid") {
      warnings.push({ type: "bad-inline-state", file: relPath, raw: inline.state.raw });
    }
    state = ruleState ?? DEFAULT_STATE;
    sourceOfTruth = ruleState !== undefined ? "rule" : "default";
  }

  const category = resolveField(
    inline.category,
    findRuleField(relPath, compiled, "category"),
    (raw) => warnings.push({ type: "bad-inline-category", file: relPath, raw }),
    (i, r) =>
      warnings.push({
        type: "disagreement",
        file: relPath,
        field: "category",
        inline: i,
        rule: r,
      }),
  );
  const ruleTags = findRuleField(relPath, compiled, "tags");
  const tags = resolveField(
    inline.tags,
    ruleTags === undefined ? undefined : [...ruleTags],
    (raw) => warnings.push({ type: "bad-inline-tags", file: relPath, raw }),
    (i, r) =>
      warnings.push({ type: "disagreement", file: relPath, field: "tags", inline: i, rule: r }),
  );
  return { state, sourceOfTruth, category, tags, warnings };
}

/**
 * Resolve one optional field: inline > rule > unset. An invalid inline value
 * warns and falls through; a valid one that differs from the rule warns too.
 */
function resolveField<T extends string | string[]>(
  inline: ParseResult<T>,
  rule: T | undefined,
  onInvalid: (raw: string) => void,
  onDisagree: (inline: T, rule: T) => void,
): Resolved<T> {
  if (inline.kind === "valid") {
    if (rule !== undefined && !sameValue(inline.value, rule)) onDisagree(inline.value, rule);
    return { value: inline.value, source: "inline" };
  }
  if (inline.kind === "invalid") onInvalid(inline.raw);
  if (rule !== undefined) return { value: rule, source: "rule" };
  return { value: undefined, source: "unset" };
}

function sameValue(a: string | string[], b: string | string[]): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * Resolve and write `state`, `category` and `tags` into every supported file
 * of a staged copy (architecture §6.8, §6.15). Each field resolves
 * independently; a file is rewritten at most once, and only when its bytes change.
 */
export async function applyInlineMetadata(
  stagedDir: string,
  rules: readonly RuleEntry[],
): Promise<StateApplyResult> {
  const compiled = compileRules(rules);
  const breakdown: StateBreakdown = { canon: 0, draft: 0, untagged: 0 };
  const categoryBreakdown: CategoryBreakdown = { byCategory: {}, unclassified: 0 };
  const tagRollup: TagRollup = { byTag: {}, untagged: 0 };
  const warnings: MetadataWarning[] = [];
  const details: StateApplyDetail[] = [];

  for await (const relPath of walk(stagedDir, stagedDir)) {
    const handler = handlerFor(relPath);
    if (!handler) {
      breakdown.untagged++;
      categoryBreakdown.unclassified++;
      tagRollup.untagged++;
      details.push({
        file: relPath,
        state: "untagged",
        sourceOfTruth: "untagged",
        categorySource: "untagged",
        tagsSource: "untagged",
      });
      continue;
    }

    const fullPath = resolve(stagedDir, relPath);
    const buf = await readFile(fullPath);
    const inline = handler.read(buf);

    const {
      state,
      sourceOfTruth,
      category,
      tags,
      warnings: fileWarnings,
    } = resolveFileMetadata(relPath, inline, compiled);
    warnings.push(...fileWarnings);

    const resolved: InlineMetadataWrite = { state };
    if (category.value !== undefined) resolved.category = category.value;
    if (tags.value !== undefined) resolved.tags = tags.value;
    const next = handler.write(buf, resolved);
    if (next !== buf) await writeFile(fullPath, next);

    breakdown[state]++;
    if (category.value !== undefined) {
      categoryBreakdown.byCategory[category.value] =
        (categoryBreakdown.byCategory[category.value] ?? 0) + 1;
    } else {
      categoryBreakdown.unclassified++;
    }
    if (tags.value !== undefined) {
      for (const tag of tags.value) tagRollup.byTag[tag] = (tagRollup.byTag[tag] ?? 0) + 1;
    } else {
      tagRollup.untagged++;
    }

    const detail: StateApplyDetail = {
      file: relPath,
      state,
      sourceOfTruth,
      categorySource: category.source,
      tagsSource: tags.source,
    };
    if (category.value !== undefined) detail.category = category.value;
    if (tags.value !== undefined) detail.tags = tags.value;
    details.push(detail);
  }

  return { breakdown, categoryBreakdown, tagRollup, warnings, details };
}

/** Historical name for {@link applyInlineMetadata}. */
export const applyState = applyInlineMetadata;
