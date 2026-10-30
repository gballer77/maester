import { extname } from "node:path";
import * as html from "./html.js";
import * as json from "./json.js";
import * as markdown from "./markdown.js";
import * as plaintext from "./plaintext.js";
import type { InlineMetadataRead, InlineMetadataWrite } from "./schema.js";
import * as yaml from "./yaml.js";

export type { InlineMetadataRead, InlineMetadataWrite, ParseResult } from "./schema.js";

export type FormatHandler = {
  /** Unsupported document shapes (e.g. a top-level YAML list) read as all-absent. */
  read(buf: Buffer): InlineMetadataRead;
  /** Returns the input buffer itself when nothing needs to change. */
  write(buf: Buffer, resolved: InlineMetadataWrite): Buffer;
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
