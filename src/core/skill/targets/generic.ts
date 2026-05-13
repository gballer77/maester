import type { SkillTarget } from "../types.js";
import {
  AGENTS_MD_ARTIFACT_PATH,
  readAgentsMdInstalledVersion,
  writeAgentsMd,
} from "./agents-md-writer.js";

export const genericTarget: SkillTarget = {
  id: "agents-md",
  label: "Generic AGENTS.md",
  artifactPaths: [AGENTS_MD_ARTIFACT_PATH],
  writerKey: "agents-md",
  write: writeAgentsMd,
  readInstalledVersion: readAgentsMdInstalledVersion,
};
