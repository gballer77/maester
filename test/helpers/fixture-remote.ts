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

  get workTree(): string {
    return resolve(this.cleanupRoot, "work");
  }

  /** Commit file writes and removals in the fixture's work tree and push them. */
  async pushCommit(changes: { files?: FixtureRemoteFile[]; remove?: string[] }): Promise<void> {
    const workTree = resolve(this.cleanupRoot, "work");
    for (const file of changes.files ?? []) {
      const dest = resolve(workTree, file.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.contents, "utf8");
    }
    for (const path of changes.remove ?? []) {
      await execFile("git", ["-C", workTree, "rm", "-q", "--", path], { env: ENV_OVERRIDE });
    }
    await execFile("git", ["-C", workTree, "add", "-A"], { env: ENV_OVERRIDE });
    await execFile("git", ["-C", workTree, "commit", "-m", "update", "--quiet"], {
      env: ENV_OVERRIDE,
    });
    await execFile("git", ["-C", workTree, "push", "origin", "HEAD", "--quiet"], {
      env: ENV_OVERRIDE,
    });
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

export type FixtureSubmodule = { path: string; remote: FixtureRemote };

/**
 * A bare remote whose tree contains git submodules pointing at other fixture
 * remotes. `file` transport is blocked for submodules by default since git
 * 2.38.1, so the fixture opts in for its own `submodule add`.
 */
export async function createBareRemoteWithSubmodules(options: {
  files: FixtureRemoteFile[];
  submodules: FixtureSubmodule[];
}): Promise<FixtureRemote> {
  const remote = await createBareRemote({ files: options.files });
  const workTree = remote.workTree;
  for (const sub of options.submodules) {
    await execFile(
      "git",
      [
        "-C",
        workTree,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "--quiet",
        sub.remote.bareRepoUrl,
        sub.path,
      ],
      { env: ENV_OVERRIDE },
    );
  }
  await execFile("git", ["-C", workTree, "commit", "-m", "add submodules", "--quiet"], {
    env: ENV_OVERRIDE,
  });
  await execFile("git", ["-C", workTree, "push", "origin", "HEAD", "--quiet"], {
    env: ENV_OVERRIDE,
  });
  return remote;
}

/** Re-pin a submodule in an umbrella fixture to its remote's latest commit and push. */
export async function bumpSubmodule(umbrella: FixtureRemote, path: string): Promise<void> {
  const subDir = resolve(umbrella.workTree, path);
  await execFile("git", ["-C", subDir, "pull", "--quiet", "origin", "HEAD"], {
    env: ENV_OVERRIDE,
  });
  await execFile("git", ["-C", umbrella.workTree, "add", path], { env: ENV_OVERRIDE });
  await execFile("git", ["-C", umbrella.workTree, "commit", "-m", "bump", "--quiet"], {
    env: ENV_OVERRIDE,
  });
  await execFile("git", ["-C", umbrella.workTree, "push", "origin", "HEAD", "--quiet"], {
    env: ENV_OVERRIDE,
  });
}
