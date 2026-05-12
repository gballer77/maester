import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function ensureScript(
  repoRoot: string,
  scriptName: string,
  command: string,
): Promise<{ added: boolean; reason: "no-package-json" | "already-set" | "added" }> {
  const path = resolve(repoRoot, "package.json");
  if (!existsSync(path)) {
    return { added: false, reason: "no-package-json" };
  }
  const raw = await readFile(path, "utf8");
  const trailingNewline = raw.endsWith("\n");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const scripts = (parsed.scripts ?? {}) as Record<string, string>;
  if (scripts[scriptName] === command) {
    return { added: false, reason: "already-set" };
  }
  if (typeof scripts[scriptName] === "string" && scripts[scriptName] !== command) {
    return { added: false, reason: "already-set" };
  }
  scripts[scriptName] = command;
  parsed.scripts = scripts;
  const serialized = JSON.stringify(parsed, null, 2) + (trailingNewline ? "\n" : "");
  await writeFile(path, serialized, "utf8");
  return { added: true, reason: "added" };
}
