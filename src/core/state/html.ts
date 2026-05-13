import type { ParseResult } from "./format.js";
import { type State, parseState } from "./schema.js";

const STATE_COMMENT_RE = /^<!--\s*state:\s*([^\s-]+)\s*-->$/;

function splitFirstLine(text: string): { firstLine: string; rest: string; eol: string } {
  const crlfIdx = text.indexOf("\r\n");
  const lfIdx = text.indexOf("\n");
  if (crlfIdx !== -1 && (lfIdx === -1 || crlfIdx <= lfIdx)) {
    return { firstLine: text.slice(0, crlfIdx), rest: text.slice(crlfIdx + 2), eol: "\r\n" };
  }
  if (lfIdx !== -1) {
    return { firstLine: text.slice(0, lfIdx), rest: text.slice(lfIdx + 1), eol: "\n" };
  }
  return { firstLine: text, rest: "", eol: "\n" };
}

export function parse(buf: Buffer): ParseResult {
  const text = buf.toString("utf8");
  const { firstLine } = splitFirstLine(text);
  const match = firstLine.match(STATE_COMMENT_RE);
  if (!match) return { kind: "absent" };
  return parseState(match[1]);
}

export function write(buf: Buffer, state: State): Buffer {
  const text = buf.toString("utf8");
  const { firstLine, rest, eol } = splitFirstLine(text);
  const desiredLine = `<!-- state: ${state} -->`;

  const existingMatch = firstLine.match(STATE_COMMENT_RE);
  if (existingMatch) {
    if (firstLine === desiredLine) return buf;
    return Buffer.from(`${desiredLine}${eol}${rest}`, "utf8");
  }

  const prefix = `${desiredLine}\n`;
  return Buffer.from(`${prefix}${text}`, "utf8");
}
