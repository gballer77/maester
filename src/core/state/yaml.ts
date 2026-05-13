import { isMap, parseDocument } from "yaml";
import type { ParseResult } from "./format.js";
import { type State, parseState } from "./schema.js";

export function parse(buf: Buffer): ParseResult {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(buf.toString("utf8"));
  } catch {
    return { kind: "absent" };
  }
  if (doc.errors.length > 0) return { kind: "absent" };
  if (!isMap(doc.contents)) return { kind: "absent" };
  const raw = doc.get("state");
  return parseState(raw);
}

export function write(buf: Buffer, state: State): Buffer {
  const text = buf.toString("utf8");
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text);
  } catch {
    return buf;
  }
  if (doc.errors.length > 0) return buf;
  if (!isMap(doc.contents)) return buf;
  if (doc.get("state") === state) return buf;
  doc.set("state", state);
  return Buffer.from(doc.toString(), "utf8");
}
