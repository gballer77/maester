import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
