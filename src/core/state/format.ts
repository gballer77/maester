import { extname } from "node:path";
import * as html from "./html.js";
import * as json from "./json.js";
import * as markdown from "./markdown.js";
import * as plaintext from "./plaintext.js";
import type { State } from "./schema.js";
import * as yaml from "./yaml.js";

export type ParseResult =
  | { kind: "valid"; value: State }
  | { kind: "invalid"; raw: string }
  | { kind: "absent" };

export type FormatHandler = {
  parse(buf: Buffer): ParseResult;
  write(buf: Buffer, state: State): Buffer;
};

const HANDLERS: Record<string, FormatHandler> = {
  ".md": markdown,
  ".markdown": markdown,
  ".html": html,
  ".htm": html,
  ".yaml": yaml,
  ".yml": yaml,
  ".json": json,
  ".txt": plaintext,
};

export function handlerFor(filePath: string): FormatHandler | undefined {
  const ext = extname(filePath).toLowerCase();
  return HANDLERS[ext];
}

export function isSupportedFormat(filePath: string): boolean {
  return handlerFor(filePath) !== undefined;
}
