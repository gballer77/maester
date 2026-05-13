import { promises as fs } from "node:fs";
import path from "node:path";
import {
  extractMarkdownRegion,
  readJsonMaesterKey,
  replaceJsonMaesterKey,
  replaceMarkdownRegion,
} from "../managed-region.js";
import {
  buildClaudeMaesterBlock,
  renderClaudeSkillBody,
  renderClaudeSkillFile,
} from "../templates/shells/claude-code.js";
import type { SkillAction, SkillTarget, SkillWriteInput, SkillWriteOutcome } from "../types.js";

const SKILL_MD_PATH = ".claude/skills/grand-maester/SKILL.md";
const SETTINGS_JSON_PATH = ".claude/settings.json";

export const claudeCodeTarget: SkillTarget = {
  id: "claude-code",
  label: "Claude Code",
  artifactPaths: [SKILL_MD_PATH, SETTINGS_JSON_PATH],
  writerKey: "claude-code",
  write: writeClaudeCode,
  readInstalledVersion,
};

async function writeClaudeCode(input: SkillWriteInput): Promise<SkillWriteOutcome> {
  const skillResult = await writeSkillMd(input);
  const settingsResult = await writeSettingsJson(input);
  const action = combineActions(skillResult.action, settingsResult.action);
  return {
    action,
    installedVersion: input.skillVersion,
  };
}

async function writeSkillMd(input: SkillWriteInput): Promise<{ action: SkillAction }> {
  const filePath = path.join(input.repoRoot, SKILL_MD_PATH);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existing = await readTextOrUndefined(filePath);
  const previousVersion = existing ? extractMarkdownRegion(existing)?.version : undefined;
  const body = renderClaudeSkillBody({ baseDir: input.citadelBaseDir });
  // Wrap the body in the managed region inside the Claude skill file shape.
  const managedRegion = replaceMarkdownRegion(undefined, body, input.skillVersion).trimEnd();
  const fileContent = existing
    ? replaceMarkdownRegion(existing, body, input.skillVersion)
    : `${renderClaudeSkillFile(managedRegion)}\n`;
  if (existing === fileContent) return { action: "unchanged" };
  await fs.writeFile(filePath, fileContent, "utf8");
  if (existing === undefined) return { action: "installed" };
  if (previousVersion === undefined) return { action: "installed" };
  return { action: "upgraded" };
}

async function writeSettingsJson(input: SkillWriteInput): Promise<{ action: SkillAction }> {
  const filePath = path.join(input.repoRoot, SETTINGS_JSON_PATH);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existing = await readTextOrUndefined(filePath);
  const previousBlock = readJsonMaesterKey(existing);
  const previousVersion =
    typeof previousBlock?.version === "string" ? previousBlock.version : undefined;
  const block = buildClaudeMaesterBlock(input.skillVersion);
  const next = replaceJsonMaesterKey(existing, block as unknown as Record<string, unknown>);
  if (existing === next) return { action: "unchanged" };
  await fs.writeFile(filePath, next, "utf8");
  if (existing === undefined || previousBlock === undefined) return { action: "installed" };
  if (previousVersion !== input.skillVersion) return { action: "upgraded" };
  return { action: "upgraded" };
}

async function readInstalledVersion(repoRoot: string): Promise<string | undefined> {
  // Source of truth is the SKILL.md begin marker. The settings.json key is the
  // hook wiring; if SKILL.md is absent the skill is not installed even if
  // settings.json has lingering hook config.
  const skillPath = path.join(repoRoot, SKILL_MD_PATH);
  const text = await readTextOrUndefined(skillPath);
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

function combineActions(a: SkillAction, b: SkillAction): SkillAction {
  if (a === "failed" || b === "failed") return "failed";
  if (a === "installed" || b === "installed") return "installed";
  if (a === "upgraded" || b === "upgraded") return "upgraded";
  return "unchanged";
}
