import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConnectorEnvVarsBestEffort } from "../../mcp/registrations/env-vars.js";
import { extractMarkdownRegion, replaceMarkdownRegion } from "../managed-region.js";
import { renderCursorRuleBody, renderCursorRuleFile } from "../templates/shells/cursor.js";
import type { SkillAction, SkillTarget, SkillWriteInput, SkillWriteOutcome } from "../types.js";

const CURSOR_RULE_PATH = ".cursor/rules/grand-maester.mdc";

export const cursorTarget: SkillTarget = {
  id: "cursor",
  label: "Cursor",
  artifactPaths: [CURSOR_RULE_PATH],
  writerKey: "cursor",
  write: writeCursor,
  readInstalledVersion,
};

async function writeCursor(input: SkillWriteInput): Promise<SkillWriteOutcome> {
  const filePath = path.join(input.repoRoot, CURSOR_RULE_PATH);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existing = await readTextOrUndefined(filePath);
  const previousVersion = existing ? extractMarkdownRegion(existing)?.version : undefined;
  // Surface required env-var names in the artifact so Cursor users know what
  // to export — Cursor's mcp.json has no working pass-through, so it relies on
  // the parent shell. Best-effort load: a missing/invalid citadel just yields
  // an empty list and the section is omitted.
  const envVars = await loadConnectorEnvVarsBestEffort(input.repoRoot);
  const body = renderCursorRuleBody({
    baseDir: input.citadelBaseDir,
    requiredEnvVars: envVars.managed,
  });
  const next = existing
    ? replaceMarkdownRegion(existing, body, input.skillVersion)
    : `${renderCursorRuleFile(
        replaceMarkdownRegion(undefined, body, input.skillVersion).trimEnd(),
        {
          baseDir: input.citadelBaseDir,
        },
      )}\n`;
  const action = decideAction(existing, previousVersion, input.skillVersion, next);
  if (action === "unchanged") {
    return previousVersion !== undefined
      ? { action, installedVersion: previousVersion }
      : { action };
  }
  await fs.writeFile(filePath, next, "utf8");
  return { action, installedVersion: input.skillVersion };
}

async function readInstalledVersion(repoRoot: string): Promise<string | undefined> {
  const filePath = path.join(repoRoot, CURSOR_RULE_PATH);
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
