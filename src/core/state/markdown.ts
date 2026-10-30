import matter from "gray-matter";
import {
  ABSENT_METADATA,
  type InlineMetadataRead,
  type InlineMetadataWrite,
  metadataChanges,
  readMetadataFields,
} from "./schema.js";

export function read(buf: Buffer): InlineMetadataRead {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(buf.toString("utf8"));
  } catch {
    return ABSENT_METADATA;
  }
  return readMetadataFields(parsed.data as Record<string, unknown>);
}

export function write(buf: Buffer, resolved: InlineMetadataWrite): Buffer {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(buf.toString("utf8"));
  } catch {
    return buf;
  }
  const sourceData = parsed.data as Record<string, unknown>;
  const changes = metadataChanges(sourceData, resolved);
  if (changes.length === 0) return buf;
  // Clone before mutating — gray-matter's content-keyed cache holds the same
  // data reference across calls; mutating it in place would pollute later
  // parses of identical input.
  const nextData = { ...sourceData, ...Object.fromEntries(changes) };
  const next = matter.stringify(parsed.content, nextData);
  return Buffer.from(next, "utf8");
}
