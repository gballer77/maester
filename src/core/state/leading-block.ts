import {
  type InlineMetadataRead,
  type InlineMetadataWrite,
  METADATA_KEYS,
  type MetadataKey,
  parseCategory,
  parseState,
  parseTags,
} from "./schema.js";

/**
 * The leading metadata block shared by HTML and plain text (architecture
 * §6.15, Gap 69): consecutive `state` / `category` / `tags` lines at the very
 * top of the file, rewritten in that fixed order. Tags are comma-separated.
 */
export type LineSyntax = {
  /** Matches one metadata line; group 1 is the key, group 2 the raw value. */
  pattern: RegExp;
  format(key: MetadataKey, value: string): string;
};

type Block = {
  /** Raw value text per key found in the block. */
  values: Partial<Record<MetadataKey, string>>;
  /** Original line text per key, so untouched fields keep their exact bytes. */
  lines: Partial<Record<MetadataKey, string>>;
  /** Byte length of the block in the text, including line terminators. */
  length: number;
  endsWithEol: boolean;
  eol: string;
};

function scanBlock(text: string, syntax: LineSyntax): Block {
  const block: Block = {
    values: {},
    lines: {},
    length: 0,
    endsWithEol: true,
    eol: detectEol(text),
  };
  let offset = 0;
  while (offset < text.length) {
    const lf = text.indexOf("\n", offset);
    const lineEnd = lf === -1 ? text.length : lf;
    const contentEnd = lineEnd > offset && text[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    const line = text.slice(offset, contentEnd);
    const match = line.match(syntax.pattern);
    const key = match?.[1] as MetadataKey | undefined;
    if (!match || key === undefined || block.values[key] !== undefined) break;
    block.values[key] = match[2] ?? "";
    block.lines[key] = line;
    offset = lf === -1 ? text.length : lf + 1;
    block.length = offset;
    block.endsWithEol = lf !== -1;
  }
  return block;
}

function detectEol(text: string): string {
  const lf = text.indexOf("\n");
  return lf > 0 && text[lf - 1] === "\r" ? "\r\n" : "\n";
}

export function readBlock(buf: Buffer, syntax: LineSyntax): InlineMetadataRead {
  const { values } = scanBlock(buf.toString("utf8"), syntax);
  return {
    state: parseState(values.state),
    category: parseCategory(values.category),
    tags: parseTags(values.tags),
  };
}

export function writeBlock(buf: Buffer, resolved: InlineMetadataWrite, syntax: LineSyntax): Buffer {
  const text = buf.toString("utf8");
  const block = scanBlock(text, syntax);
  const desired: Record<MetadataKey, string | undefined> = {
    state: resolved.state,
    category: resolved.category,
    tags: resolved.tags?.join(", "),
  };
  const lines: string[] = [];
  for (const key of METADATA_KEYS) {
    const value = desired[key];
    // An unset field keeps whatever line the file already had — the writer never deletes.
    if (value !== undefined) lines.push(syntax.format(key, value));
    else if (block.lines[key] !== undefined) lines.push(block.lines[key]);
  }
  const hadBlock = block.length > 0;
  const trailing = hadBlock && !block.endsWithEol ? "" : block.eol;
  const next = `${lines.join(block.eol)}${trailing}`;
  if (next === text.slice(0, block.length)) return buf;
  return Buffer.from(`${next}${text.slice(block.length)}`, "utf8");
}
