import { promises as fs } from "node:fs";
import path from "node:path";
import { extractMarkdownRegion, replaceMarkdownRegion } from "../managed-region.js";
import { renderCodexSkillBody, renderCodexSkillFile } from "../templates/shells/codex.js";
import type { SkillAction, SkillTarget, SkillWriteInput, SkillWriteOutcome } from "../types.js";

const SKILL_MD_PATH = ".agents/skills/grand-maester/SKILL.md";

export const codexTarget: SkillTarget = {
  id: "codex",
  label: "Codex CLI",
  artifactPaths: [SKILL_MD_PATH],
  writerKey: "codex",
  write: writeCodex,
  readInstalledVersion,
};

async function writeCodex(input: SkillWriteInput): Promise<SkillWriteOutcome> {
  const filePath = path.join(input.repoRoot, SKILL_MD_PATH);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existing = await readTextOrUndefined(filePath);
  const previousVersion = existing ? extractMarkdownRegion(existing)?.version : undefined;
  const body = renderCodexSkillBody({ baseDir: input.citadelBaseDir });
  const managedRegion = replaceMarkdownRegion(undefined, body, input.skillVersion).trimEnd();
  const fileContent = existing
    ? replaceMarkdownRegion(existing, body, input.skillVersion)
    : `${renderCodexSkillFile(managedRegion)}\n`;
  const action = decideAction(existing, previousVersion, input.skillVersion, fileContent);
  if (action === "unchanged") {
    return previousVersion !== undefined
      ? { action, installedVersion: previousVersion }
      : { action };
  }
  await fs.writeFile(filePath, fileContent, "utf8");
  return { action, installedVersion: input.skillVersion };
}

async function readInstalledVersion(repoRoot: string): Promise<string | undefined> {
  const filePath = path.join(repoRoot, SKILL_MD_PATH);
  const text = await readTextOrUndefined(filePath);
  if (!text) return undefined;
  return extractMarkdownRegion(text)?.version;
}

async function readTextOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

function decideAction(
  existing: string | undefined,
  previousVersion: string | undefined,
  newVersion: string,
  newContent: string,
): SkillAction {
  if (existing === undefined) return "installed";
  if (existing === newContent) return "unchanged";
  if (previousVersion === undefined) return "installed";
  if (previousVersion !== newVersion) return "upgraded";
  return "upgraded";
}
