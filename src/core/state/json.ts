import type { ParseResult } from "./format.js";
import { type State, parseState } from "./schema.js";

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

export function parse(buf: Buffer): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(buf.toString("utf8"));
  } catch {
    return { kind: "absent" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "absent" };
  }
  return parseState((value as Record<string, unknown>).state);
}

export function write(buf: Buffer, state: State): Buffer {
  const text = buf.toString("utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return buf;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return buf;
  }
  const obj = value as Record<string, unknown>;
  if (obj.state === state) return buf;
  obj.state = state;
  const indent = detectIndent(text);
  const trailing = detectTrailingNewline(text);
  const serialized = JSON.stringify(obj, null, indent);
  return Buffer.from(`${serialized}${trailing}`, "utf8");
}
