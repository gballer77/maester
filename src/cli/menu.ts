import { type RepoRoles, detectRoles } from "../core/config/paths.js";
import type { CliContext } from "./context.js";

export type MenuChoice =
  | "init"
  | "publish"
  | "source-add"
  | "source-remove"
  | "source-list"
  | "document-add"
  | "document-remove"
  | "document-list"
  | "status"
  | "exit";

export type MenuOption = { value: MenuChoice; label: string; hint?: string };

/**
 * Top-level menu entries for the roles present. A configured role keeps its
 * "View …" entry and gains the config-editing verbs, labelled by role so the
 * six stay distinguishable when both roles are configured (architecture §6.18).
 */
export function topLevelMenuOptions(roles: RepoRoles): MenuOption[] {
  const options: MenuOption[] = [];
  if (roles.hasCitadel) {
    options.push(
      { value: "init", label: "Citadel: view", hint: "summary of the existing config" },
      { value: "source-add", label: "Citadel: add source", hint: "same prompts as init" },
      { value: "source-remove", label: "Citadel: remove source" },
      { value: "source-list", label: "Citadel: list sources" },
    );
  } else {
    options.push({
      value: "init",
      label: "Initialize a citadel",
      hint: "this repo pulls from remote knowledge sources",
    });
  }
  if (roles.hasMaester) {
    options.push(
      {
        value: "publish",
        label: "Maester: view manifest",
        hint: "summary of the existing manifest",
      },
      { value: "document-add", label: "Maester: add document", hint: "same prompts as publish" },
      { value: "document-remove", label: "Maester: remove document" },
      { value: "document-list", label: "Maester: list documents" },
    );
  } else {
    options.push({
      value: "publish",
      label: "Configure this repo as a maester",
      hint: "this repo publishes documents",
    });
  }
  options.push(
    {
      value: "status",
      label: "Show status",
      hint: "check whether configured sources are up to date",
    },
    { value: "exit", label: "Exit" },
  );
  return options;
}

export async function showTopLevelMenu(ctx: CliContext): Promise<MenuChoice> {
  return ctx.prompts.select<MenuChoice>({
    message: "What would you like to do?",
    options: topLevelMenuOptions(detectRoles(ctx.repoRoot.path)),
  });
}
