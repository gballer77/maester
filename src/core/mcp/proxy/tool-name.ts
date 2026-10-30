import { createHash } from "node:crypto";

/** Host-side tool-name limit common to Claude Code, Cursor and Codex (Gap 59). */
export const MAX_TOOL_NAME_LENGTH = 64;

/**
 * `<server>__<tool>`: server `-` → `_`; upstream name lowercased with every
 * character outside `[a-z0-9_]` → `_`. Over 64 characters, the right half is
 * truncated and suffixed with 6 hex chars of the upstream name's sha1 so
 * distinct long names stay distinct.
 */
export function proxiedToolName(server: string, upstream: string): string {
  const left = server.replace(/-/g, "_");
  const right = upstream.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const full = `${left}__${right}`;
  if (full.length <= MAX_TOOL_NAME_LENGTH) return full;
  const hash = createHash("sha1").update(upstream).digest("hex").slice(0, 6);
  const room = MAX_TOOL_NAME_LENGTH - left.length - 2 - 1 - hash.length;
  return `${left}__${right.slice(0, Math.max(0, room))}_${hash}`;
}
