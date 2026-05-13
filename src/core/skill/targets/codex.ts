import type { SkillTarget } from "../types.js";
import {
  AGENTS_MD_ARTIFACT_PATH,
  readAgentsMdInstalledVersion,
  writeAgentsMd,
} from "./agents-md-writer.js";

export const codexTarget: SkillTarget = {
  id: "codex",
  label: "Codex CLI",
  artifactPaths: [AGENTS_MD_ARTIFACT_PATH],
  writerKey: "agents-md",
  write: writeAgentsMd,
  readInstalledVersion: readAgentsMdInstalledVersion,
};
