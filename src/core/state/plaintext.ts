import { type LineSyntax, readBlock, writeBlock } from "./leading-block.js";
import type { InlineMetadataRead, InlineMetadataWrite } from "./schema.js";

const SYNTAX: LineSyntax = {
  pattern: /^(state|category|tags):\s+(.*?)\s*$/,
  format: (key, value) => `${key}: ${value}`,
};

export function read(buf: Buffer): InlineMetadataRead {
  return readBlock(buf, SYNTAX);
}

export function write(buf: Buffer, resolved: InlineMetadataWrite): Buffer {
  return writeBlock(buf, resolved, SYNTAX);
}
