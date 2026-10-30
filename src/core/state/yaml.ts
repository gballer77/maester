import { type Document, isMap, parseDocument } from "yaml";
import {
  ABSENT_METADATA,
  type InlineMetadataRead,
  type InlineMetadataWrite,
  metadataChanges,
  readMetadataFields,
} from "./schema.js";

function parseMap(text: string): Document | undefined {
  let doc: Document;
  try {
    doc = parseDocument(text);
  } catch {
    return undefined;
  }
  if (doc.errors.length > 0) return undefined;
  if (!isMap(doc.contents)) return undefined;
  return doc;
}

function plainData(doc: Document): Record<string, unknown> {
  return doc.toJS({ maxAliasCount: -1 }) as Record<string, unknown>;
}

export function read(buf: Buffer): InlineMetadataRead {
  const doc = parseMap(buf.toString("utf8"));
  if (!doc) return ABSENT_METADATA;
  return readMetadataFields(plainData(doc));
}

export function write(buf: Buffer, resolved: InlineMetadataWrite): Buffer {
  const doc = parseMap(buf.toString("utf8"));
  if (!doc) return buf;
  const changes = metadataChanges(plainData(doc), resolved);
  if (changes.length === 0) return buf;
  for (const [key, value] of changes) doc.set(key, value);
  return Buffer.from(doc.toString(), "utf8");
}
