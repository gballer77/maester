import matter from "gray-matter";
import type { ParseResult } from "./format.js";
import { type State, parseState } from "./schema.js";

export function parse(buf: Buffer): ParseResult {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(buf.toString("utf8"));
  } catch {
    return { kind: "absent" };
  }
  const raw = (parsed.data as Record<string, unknown>).state;
  return parseState(raw);
}

export function write(buf: Buffer, state: State): Buffer {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(buf.toString("utf8"));
  } catch {
    return buf;
  }
  const sourceData = parsed.data as Record<string, unknown>;
  if (sourceData.state === state) return buf;
  // Clone before mutating — gray-matter's content-keyed cache holds the same
  // data reference across calls; mutating it in place would pollute later
  // parses of identical input.
  const nextData = { ...sourceData, state };
  const next = matter.stringify(parsed.content, nextData);
  return Buffer.from(next, "utf8");
}
