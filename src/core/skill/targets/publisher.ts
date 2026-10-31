import { promises as fs } from "node:fs";
import path from "node:path";
import { extractMarkdownRegion, replaceMarkdownRegion } from "../managed-region.js";
import { agentsMdPreamble } from "../templates/shells/agents-md.js";
import {
  renderPublisherBody,
  renderPublisherCursorRule,
  renderPublisherSkillFile,
} from "../templates/shells/publisher.js";
import type {
  SkillAction,
  SkillTarget,
  SkillTargetId,
  SkillWriteInput,
  SkillWriteOutcome,
} from "../types.js";

/**
 * Publisher targets (architecture §6.19). Every artifact is a Markdown file
 * holding one `maester:publisher` managed region; a new file gets its
 * target's shell (frontmatter or preamble) around the region. In `AGENTS.md`
 * the region sits beside the Grand Maester's own, and neither touches the other.
 */
type PublisherArtifact = {
  id: SkillTargetId;
  label: string;
  artifactPath: string;
  /** Wrap a freshly rendered region into a new file. */
  shell: (region: string) => string;
};

const ARTIFACTS: readonly PublisherArtifact[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    artifactPath: ".claude/skills/maester-publisher/SKILL.md",
    shell: renderPublisherSkillFile,
  },
  {
    id: "codex",
    label: "Codex CLI",
    artifactPath: ".agents/skills/maester-publisher/SKILL.md",
    shell: renderPublisherSkillFile,
  },
  {
    id: "cursor",
    label: "Cursor",
    artifactPath: ".cursor/rules/maester-publisher.mdc",
    shell: renderPublisherCursorRule,
  },
  {
    id: "agents-md",
    label: "Generic AGENTS.md",
    artifactPath: "AGENTS.md",
    shell: (region) => `${agentsMdPreamble()}\n${region}`,
  },
];

export const PUBLISHER_TARGETS: readonly SkillTarget[] = ARTIFACTS.map((artifact) => ({
  id: artifact.id,
  label: artifact.label,
  artifactPaths: [artifact.artifactPath],
  writerKey: `publisher:${artifact.id}`,
  write: (input: SkillWriteInput) => writePublisher(artifact, input),
  readInstalledVersion: async (repoRoot: string) => {
    const text = await readTextOrUndefined(path.join(repoRoot, artifact.artifactPath));
    return text ? extractMarkdownRegion(text, "publisher")?.version : undefined;
  },
}));

async function writePublisher(
  artifact: PublisherArtifact,
  input: SkillWriteInput,
): Promise<SkillWriteOutcome> {
  const filePath = path.join(input.repoRoot, artifact.artifactPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existing = await readTextOrUndefined(filePath);
  const previousVersion = existing
    ? extractMarkdownRegion(existing, "publisher")?.version
    : undefined;
  const body = renderPublisherBody();
  const next =
    existing !== undefined
      ? replaceMarkdownRegion(existing, body, input.skillVersion, "", "publisher")
      : `${artifact.shell(
          replaceMarkdownRegion(undefined, body, input.skillVersion, "", "publisher").trimEnd(),
        )}\n`;
  const action = decideAction(existing, previousVersion, next);
  if (action === "unchanged") {
    return previousVersion !== undefined
      ? { action, installedVersion: previousVersion }
      : { action };
  }
  await fs.writeFile(filePath, next, "utf8");
  return { action, installedVersion: input.skillVersion };
}

function decideAction(
  existing: string | undefined,
  previousVersion: string | undefined,
  next: string,
): SkillAction {
  if (existing === undefined || previousVersion === undefined) return "installed";
  if (existing === next) return "unchanged";
  return "upgraded";
}

async function readTextOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
