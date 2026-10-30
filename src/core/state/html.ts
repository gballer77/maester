import { type LineSyntax, readBlock, writeBlock } from "./leading-block.js";
import type { InlineMetadataRead, InlineMetadataWrite } from "./schema.js";

// Written before any <!DOCTYPE>, mirroring gspec/style.html's spec-version comment.
const SYNTAX: LineSyntax = {
  pattern: /^<!--\s*(state|category|tags):\s*(.*?)\s*-->$/,
  format: (key, value) => `<!-- ${key}: ${value} -->`,
};

export function read(buf: Buffer): InlineMetadataRead {
  return readBlock(buf, SYNTAX);
}

export function write(buf: Buffer, resolved: InlineMetadataWrite): Buffer {
  return writeBlock(buf, resolved, SYNTAX);
}
