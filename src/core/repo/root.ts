import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type RepoRoot = {
  path: string;
  hasGit: boolean;
  hasPackageJson: boolean;
};

export function findRepoRoot(start: string = process.cwd()): RepoRoot | undefined {
  let current = resolve(start);
  while (true) {
    const hasGit = existsSync(resolve(current, ".git"));
    const hasPackageJson = existsSync(resolve(current, "package.json"));
    if (hasGit || hasPackageJson) {
      return { path: current, hasGit, hasPackageJson };
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
