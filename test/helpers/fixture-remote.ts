import { execFile as execFileCb } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const ENV_OVERRIDE: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

export type FixtureRemoteFile = {
  path: string;
  contents: string;
};

export type FixtureRemoteOptions = {
  files: FixtureRemoteFile[];
  branch?: string;
};

export class FixtureRemote {
  constructor(
    public readonly bareRepoUrl: string,
    private readonly cleanupRoot: string,
  ) {}
  async cleanup(): Promise<void> {
    await rm(this.cleanupRoot, { recursive: true, force: true });
  }
}

export async function createBareRemote(options: FixtureRemoteOptions): Promise<FixtureRemote> {
  const root = await mkdtemp(join(tmpdir(), "maester-remote-"));
  const workTree = resolve(root, "work");
  const bareRepo = resolve(root, "remote.git");
  await mkdir(workTree, { recursive: true });
  await mkdir(bareRepo, { recursive: true });

  const branch = options.branch ?? "main";

  await execFile("git", ["init", "--initial-branch", branch, "--quiet", workTree], {
    env: ENV_OVERRIDE,
  });
  for (const file of options.files) {
    const dest = resolve(workTree, file.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.contents, "utf8");
  }
  await execFile("git", ["-C", workTree, "add", "-A"], { env: ENV_OVERRIDE });
  await execFile("git", ["-C", workTree, "commit", "-m", "initial commit", "--quiet"], {
    env: ENV_OVERRIDE,
  });

  await execFile("git", ["init", "--bare", "--initial-branch", branch, "--quiet", bareRepo], {
    env: ENV_OVERRIDE,
  });
  await execFile("git", ["-C", workTree, "remote", "add", "origin", bareRepo], {
    env: ENV_OVERRIDE,
  });
  await execFile("git", ["-C", workTree, "push", "-u", "origin", branch, "--quiet"], {
    env: ENV_OVERRIDE,
  });

  return new FixtureRemote(bareRepo, root);
}
