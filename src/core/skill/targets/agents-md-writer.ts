import { promises as fs } from "node:fs";
import path from "node:path";
import { extractMarkdownRegion, replaceMarkdownRegion } from "../managed-region.js";
import { agentsMdPreamble, renderAgentsMdBody } from "../templates/shells/agents-md.js";
import type { SkillAction, SkillWriteInput, SkillWriteOutcome } from "../types.js";

export const AGENTS_MD_ARTIFACT_PATH = "AGENTS.md";

export async function writeAgentsMd(input: SkillWriteInput): Promise<SkillWriteOutcome> {
  const filePath = path.join(input.repoRoot, AGENTS_MD_ARTIFACT_PATH);
  const existingText = await readTextOrUndefined(filePath);
  const previousVersion = existingText ? extractMarkdownRegion(existingText)?.version : undefined;
  const body = renderAgentsMdBody({ baseDir: input.citadelBaseDir });
  const next = replaceMarkdownRegion(existingText, body, input.skillVersion, agentsMdPreamble());
  const action = decideAction(existingText, previousVersion, input.skillVersion, next);
  if (action === "unchanged") {
    return previousVersion !== undefined
      ? { action, installedVersion: previousVersion }
      : { action };
  }
  await fs.writeFile(filePath, next, "utf8");
  return { action, installedVersion: input.skillVersion };
}

export async function readAgentsMdInstalledVersion(repoRoot: string): Promise<string | undefined> {
  const filePath = path.join(repoRoot, AGENTS_MD_ARTIFACT_PATH);
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
