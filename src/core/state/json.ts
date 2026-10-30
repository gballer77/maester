import {
  ABSENT_METADATA,
  type InlineMetadataRead,
  type InlineMetadataWrite,
  metadataChanges,
  readMetadataFields,
} from "./schema.js";

function detectIndent(text: string): number | "\t" {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("\t")) return "\t";
    const match = line.match(/^( +)\S/);
    if (match) return match[1]?.length ?? 2;
  }
  return 2;
}

function detectTrailingNewline(text: string): string {
  return text.endsWith("\n") ? "\n" : "";
}

function parseObject(text: string): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function read(buf: Buffer): InlineMetadataRead {
  const obj = parseObject(buf.toString("utf8"));
  return obj ? readMetadataFields(obj) : ABSENT_METADATA;
}

export function write(buf: Buffer, resolved: InlineMetadataWrite): Buffer {
  const text = buf.toString("utf8");
  const obj = parseObject(text);
  if (!obj) return buf;
  const changes = metadataChanges(obj, resolved);
  if (changes.length === 0) return buf;
  // Existing keys keep their position; new keys append in state → category → tags order.
  for (const [key, value] of changes) obj[key] = value;
  const serialized = JSON.stringify(obj, null, detectIndent(text));
  return Buffer.from(`${serialized}${detectTrailingNewline(text)}`, "utf8");
}
