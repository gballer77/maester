import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export async function makeTmpRepo(
  options: { withGit?: boolean; withPackageJson?: boolean } = {},
): Promise<TempRepo> {
  const dir = await mkdtemp(join(tmpdir(), "maester-test-"));
  if (options.withGit !== false) {
    await execFile("git", ["init", "--initial-branch=main", "--quiet", dir]);
  }
  if (options.withPackageJson !== false) {
    await writeFile(
      resolve(dir, "package.json"),
      `${JSON.stringify({ name: "test-repo", version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );
  }
  return new TempRepo(dir);
}

export class TempRepo {
  constructor(public readonly path: string) {}

  resolve(...segments: string[]): string {
    return resolve(this.path, ...segments);
  }

  async writeFile(rel: string, contents: string): Promise<void> {
    const target = this.resolve(rel);
    await writeFile(target, contents, "utf8");
  }

  async cleanup(): Promise<void> {
    await rm(this.path, { recursive: true, force: true });
  }
}
