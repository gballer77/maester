import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/** The line link-mode sync appends for a destination: `/<rel>/`, posix separators. */
export function gitignoreEntryFor(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return `/${normalized}/`;
}

/**
 * Is the repo-relative directory already ignored? Uses `git check-ignore` when
 * the repo has `.git/` (so broader rules like `/citadel/` count), and falls
 * back to an exact-line match on `.gitignore` otherwise or if git errors.
 */
export async function isIgnored(repoRoot: string, relPath: string): Promise<boolean> {
  const dirPath = `${relPath.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
  if (existsSync(resolve(repoRoot, ".git"))) {
    try {
      await execFile("git", ["check-ignore", "-q", "--", dirPath], { cwd: repoRoot });
      return true;
    } catch (err) {
      // Exit code 1 = not ignored; anything else (128) means git could not
      // answer, so fall through to the line match.
      if ((err as { code?: number }).code === 1) return false;
    }
  }
  return lineMatches(repoRoot, relPath);
}

async function lineMatches(repoRoot: string, relPath: string): Promise<boolean> {
  const path = resolve(repoRoot, ".gitignore");
  if (!existsSync(path)) return false;
  const bare = relPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const variants = new Set([bare, `${bare}/`, `/${bare}`, `/${bare}/`]);
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).map((l) => l.trim());
  return lines.some((line) => variants.has(line));
}

export async function appendMissingGitignoreEntries(
  repoRoot: string,
  entries: readonly string[],
): Promise<{ added: string[]; alreadyPresent: string[] }> {
  const path = resolve(repoRoot, ".gitignore");
  let existing = "";
  if (existsSync(path)) {
    existing = await readFile(path, "utf8");
  }

  const existingLines = new Set(
    existing
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );
  const added: string[] = [];
  const alreadyPresent: string[] = [];

  for (const entry of entries) {
    const normalized = entry.trim();
    if (normalized.length === 0) continue;
    if (existingLines.has(normalized)) {
      alreadyPresent.push(normalized);
    } else {
      added.push(normalized);
      existingLines.add(normalized);
    }
  }

  if (added.length === 0) {
    return { added, alreadyPresent };
  }

  const needsTrailingNewline = existing.length > 0 && !existing.endsWith("\n");
  const appendBlock = `${needsTrailingNewline ? "\n" : ""}${added.join("\n")}\n`;
  await writeFile(path, `${existing}${appendBlock}`, "utf8");
  return { added, alreadyPresent };
}
