import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type RepoRoot = {
  path: string;
  hasGit: boolean;
  hasPackageJson: boolean;
};

export function getRepoRoot(start: string = process.cwd()): RepoRoot {
  const path = resolve(start);
  return {
    path,
    hasGit: existsSync(resolve(path, ".git")),
    hasPackageJson: existsSync(resolve(path, "package.json")),
  };
}
