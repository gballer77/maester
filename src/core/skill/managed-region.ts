const BEGIN_MARKER_RE = /<!--\s*maester:skill:begin(?:\s+v=([^\s>]+))?\s*-->/;
const END_MARKER_LITERAL = "<!-- maester:skill:end -->";

export type MarkdownRegion = {
  /** Bytes before the begin marker (preserved on rewrite). */
  prefix: string;
  /** Bytes after the end marker (preserved on rewrite). */
  suffix: string;
  /** Version extracted from the begin marker, if present. */
  version: string | undefined;
};

/**
 * Locate the maester-managed region in a Markdown file. Returns `undefined` when
 * no region is present (caller should treat the entire file as user content).
 */
export function extractMarkdownRegion(text: string): MarkdownRegion | undefined {
  const beginMatch = BEGIN_MARKER_RE.exec(text);
  if (!beginMatch) return undefined;
  const beginIdx = beginMatch.index;
  const afterBegin = beginIdx + beginMatch[0].length;
  const endIdx = text.indexOf(END_MARKER_LITERAL, afterBegin);
  if (endIdx < 0) return undefined;
  const suffixStart = endIdx + END_MARKER_LITERAL.length;
  return {
    prefix: text.slice(0, beginIdx),
    suffix: text.slice(suffixStart),
    version: beginMatch[1],
  };
}

/**
 * Build a Markdown file containing the maester managed region. When `existing`
 * is provided, content before the begin marker and after the end marker is
 * preserved exactly. When `existing` is absent, only the managed region is
 * emitted (callers may wrap with a preamble of their choice).
 */
export function replaceMarkdownRegion(
  existing: string | undefined,
  body: string,
  version: string,
  preambleWhenAbsent = "",
): string {
  const region = renderManagedRegion(body, version);
  if (existing === undefined) {
    if (preambleWhenAbsent.length === 0) {
      return `${region}\n`;
    }
    return `${preambleWhenAbsent}${preambleWhenAbsent.endsWith("\n") ? "" : "\n"}${region}\n`;
  }
  const found = extractMarkdownRegion(existing);
  if (!found) {
    const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    return `${existing}${sep}${region}\n`;
  }
  return `${found.prefix}${region}${found.suffix}`;
}

function renderManagedRegion(body: string, version: string): string {
  const inner = body.endsWith("\n") ? body.slice(0, -1) : body;
  return `<!-- maester:skill:begin v=${version} -->\n${inner}\n${END_MARKER_LITERAL}`;
}

export type ClaudeSettings = Record<string, unknown>;

/**
 * Parse a `.claude/settings.json` document, replace its top-level `maester`
 * key with the supplied object, and re-serialize. Every other top-level key
 * is preserved; key order is preserved by treating the `maester` key as the
 * last entry when not previously present.
 */
export function replaceJsonMaesterKey(
  existingText: string | undefined,
  maesterBlock: Record<string, unknown>,
): string {
  const parsed: ClaudeSettings =
    existingText && existingText.trim().length > 0
      ? (JSON.parse(existingText) as ClaudeSettings)
      : {};
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected .claude/settings.json to be a JSON object at the top level.");
  }
  // Rebuild with the maester key at the same position when present, or appended.
  const rebuilt: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "maester") {
      rebuilt[key] = maesterBlock;
      placed = true;
    } else {
      rebuilt[key] = value;
    }
  }
  if (!placed) {
    rebuilt.maester = maesterBlock;
  }
  return `${JSON.stringify(rebuilt, null, 2)}\n`;
}

/**
 * Read the maester block from a `.claude/settings.json` document if any.
 */
export function readJsonMaesterKey(
  existingText: string | undefined,
): Record<string, unknown> | undefined {
  if (!existingText || existingText.trim().length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(existingText);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const block = (parsed as Record<string, unknown>).maester;
  if (typeof block !== "object" || block === null || Array.isArray(block)) return undefined;
  return block as Record<string, unknown>;
}
