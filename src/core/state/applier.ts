import type { Dirent } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import picomatch from "picomatch";
import { handlerFor } from "./format.js";
import { DEFAULT_STATE, type RuleEntry, type State } from "./schema.js";

export type SourceOfTruth = "inline" | "rule" | "default";

export type StateBreakdown = {
  canon: number;
  draft: number;
  untagged: number;
};

export type BadInlineStateWarning = {
  type: "bad-inline-state";
  file: string;
  raw: string;
};

export type DisagreementWarning = {
  type: "disagreement";
  file: string;
  inline: State;
  rule: State;
};

export type StateWarning = BadInlineStateWarning | DisagreementWarning;

export type StateApplyDetail = {
  file: string;
  state: State | "untagged";
  sourceOfTruth: SourceOfTruth | "untagged";
};

export type StateApplyResult = {
  breakdown: StateBreakdown;
  warnings: StateWarning[];
  details: StateApplyDetail[];
};

const MATCHER_OPTIONS = { dot: false, nocase: false } as const;

function compileMatchers(rules: readonly RuleEntry[]): Array<(p: string) => boolean> {
  return rules.map((r) => picomatch(r.pattern, MATCHER_OPTIONS));
}

function findRuleState(
  filePath: string,
  rules: readonly RuleEntry[],
  matchers: Array<(p: string) => boolean>,
): State | undefined {
  for (let i = 0; i < rules.length; i++) {
    const match = matchers[i];
    const rule = rules[i];
    if (!match || !rule) continue;
    if (!match(filePath)) continue;
    if (rule.state !== undefined) return rule.state;
    return undefined;
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

export async function applyState(
  stagedDir: string,
  rules: readonly RuleEntry[],
): Promise<StateApplyResult> {
  const matchers = compileMatchers(rules);
  const breakdown: StateBreakdown = { canon: 0, draft: 0, untagged: 0 };
  const warnings: StateWarning[] = [];
  const details: StateApplyDetail[] = [];

  for await (const relPath of walk(stagedDir, stagedDir)) {
    const handler = handlerFor(relPath);
    if (!handler) {
      breakdown.untagged++;
      details.push({ file: relPath, state: "untagged", sourceOfTruth: "untagged" });
      continue;
    }

    const fullPath = resolve(stagedDir, relPath);
    const buf = await readFile(fullPath);
    const parsed = handler.parse(buf);

    let resolved: State;
    let sourceOfTruth: SourceOfTruth;

    if (parsed.kind === "valid") {
      resolved = parsed.value;
      sourceOfTruth = "inline";
      const ruleState = findRuleState(relPath, rules, matchers);
      if (ruleState !== undefined && ruleState !== resolved) {
        warnings.push({
          type: "disagreement",
          file: relPath,
          inline: resolved,
          rule: ruleState,
        });
      }
    } else {
      if (parsed.kind === "invalid") {
        warnings.push({ type: "bad-inline-state", file: relPath, raw: parsed.raw });
      }
      const ruleState = findRuleState(relPath, rules, matchers);
      if (ruleState !== undefined) {
        resolved = ruleState;
        sourceOfTruth = "rule";
      } else {
        resolved = DEFAULT_STATE;
        sourceOfTruth = "default";
      }
    }

    const next = handler.write(buf, resolved);
    if (next !== buf) {
      await writeFile(fullPath, next);
    }

    breakdown[resolved]++;
    details.push({ file: relPath, state: resolved, sourceOfTruth });
  }

  return { breakdown, warnings, details };
}
