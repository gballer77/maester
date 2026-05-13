import { detectRoles } from "../core/config/paths.js";
import type { CliContext } from "./context.js";

export type MenuChoice = "init" | "publish" | "status" | "exit";

export async function showTopLevelMenu(ctx: CliContext): Promise<MenuChoice> {
  const roles = detectRoles(ctx.repoRoot.path);
  const citadelLabel = roles.hasCitadel ? "View citadel" : "Initialize a citadel";
  const citadelHint = roles.hasCitadel
    ? "summary of the existing config"
    : "this repo pulls from remote knowledge sources";
  const maesterLabel = roles.hasMaester
    ? "View maester manifest"
    : "Configure this repo as a maester";
  const maesterHint = roles.hasMaester
    ? "summary of the existing manifest"
    : "this repo publishes documents";

  return ctx.prompts.select<MenuChoice>({
    message: "What would you like to do?",
    options: [
      { value: "init", label: citadelLabel, hint: citadelHint },
      { value: "publish", label: maesterLabel, hint: maesterHint },
      {
        value: "status",
        label: "Show status",
        hint: "check whether configured sources are up to date",
      },
      { value: "exit", label: "Exit" },
    ],
  });
}
