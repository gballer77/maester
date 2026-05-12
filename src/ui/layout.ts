import { SPACING } from "./theme/tokens.js";

const NEWLINE_RE = /\r?\n/;

export function stack(lines: readonly string[], gap: 0 | 1 | 2 = SPACING.lg): string {
  const separator = "\n".repeat(gap + 1);
  return lines.filter((l) => l.length > 0).join(separator);
}

export function keyValue(pairs: readonly { key: string; value: string }[]): string {
  if (pairs.length === 0) return "";
  const width = Math.max(...pairs.map((p) => p.key.length));
  return pairs.map((p) => `${p.key.padEnd(width)}  ${p.value}`).join("\n");
}

export function indent(text: string, cells: number = SPACING.sm): string {
  const pad = " ".repeat(cells);
  return text
    .split(NEWLINE_RE)
    .map((line) => (line.length === 0 ? line : `${pad}${line}`))
    .join("\n");
}

export function wrap(text: string, width: number): string {
  if (width <= 0) return text;
  const out: string[] = [];
  for (const paragraph of text.split(/\n\n+/)) {
    out.push(wrapParagraph(paragraph, width));
  }
  return out.join("\n\n");
}

function wrapParagraph(text: string, width: number): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return text;
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.join("\n");
}
