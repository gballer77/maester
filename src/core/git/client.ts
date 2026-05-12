import { execFile as execFileCb } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { type SimpleGit, simpleGit } from "simple-git";
import { RefNotFoundError } from "../errors.js";

const execFile = promisify(execFileCb);

export type GitCapabilities = {
  version: string;
  supportsPartialClone: boolean;
};

let cachedCapabilities: GitCapabilities | undefined;

export async function detectGitCapabilities(): Promise<GitCapabilities> {
  if (cachedCapabilities) return cachedCapabilities;
  const { stdout } = await execFile("git", ["--version"]);
  const match = stdout.match(/git version (\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    cachedCapabilities = { version: stdout.trim(), supportsPartialClone: false };
    return cachedCapabilities;
  }
  const major = Number(match[1] ?? 0);
  const minor = Number(match[2] ?? 0);
  const supportsPartialClone = major > 2 || (major === 2 && minor >= 27);
  cachedCapabilities = { version: `${major}.${minor}`, supportsPartialClone };
  return cachedCapabilities;
}

export function clearGitCapabilityCache(): void {
  cachedCapabilities = undefined;
}

export type CloneInput = {
  url: string;
  destination: string;
  ref: string | undefined;
  useTokenInUrl?: string;
};

export async function shallowSparseClone(input: CloneInput): Promise<SimpleGit> {
  await mkdir(input.destination, { recursive: true });
  const caps = await detectGitCapabilities();
  const url = input.useTokenInUrl ? injectToken(input.url, input.useTokenInUrl) : input.url;

  const git = simpleGit(input.destination);

  if (caps.supportsPartialClone) {
    const cloneArgs = ["--filter=blob:none", "--depth=1", "--no-checkout", "--sparse"];
    if (input.ref) cloneArgs.push("--branch", input.ref);
    try {
      await git.clone(url, ".", cloneArgs);
    } catch (err) {
      if (input.ref && refNotFoundFromError(err)) {
        throw new RefNotFoundError(input.ref, input.url, err);
      }
      throw err;
    }
  } else {
    const cloneArgs: string[] = ["--depth=1"];
    if (input.ref) cloneArgs.push("--branch", input.ref);
    try {
      await git.clone(url, ".", cloneArgs);
    } catch (err) {
      if (input.ref && refNotFoundFromError(err)) {
        throw new RefNotFoundError(input.ref, input.url, err);
      }
      throw err;
    }
  }
  return git;
}

export async function setSparsePatterns(
  workDir: string,
  patterns: readonly string[],
): Promise<void> {
  const git = simpleGit(workDir);
  if (patterns.length === 0) {
    await git.raw(["sparse-checkout", "disable"]);
    return;
  }
  await git.raw(["sparse-checkout", "set", "--no-cone", ...patterns]);
}

export async function checkoutRef(workDir: string, ref: string | undefined): Promise<string> {
  const git = simpleGit(workDir);
  try {
    if (ref) await git.checkout(ref);
    else await git.checkout(["HEAD"]);
  } catch (err) {
    if (ref && refNotFoundFromError(err)) {
      throw new RefNotFoundError(ref, await tryReadOriginUrl(workDir), err);
    }
    throw err;
  }
  const sha = (await git.revparse(["HEAD"])).trim();
  return sha;
}

export async function fetchHead(workDir: string, ref: string | undefined): Promise<string> {
  const git = simpleGit(workDir);
  const args = ref ? ["--depth=1", "origin", ref] : ["--depth=1", "origin"];
  try {
    await git.fetch(args);
  } catch (err) {
    if (ref && refNotFoundFromError(err)) {
      throw new RefNotFoundError(ref, await tryReadOriginUrl(workDir), err);
    }
    throw err;
  }
  await git.raw(["reset", "--hard", "FETCH_HEAD"]);
  return (await git.revparse(["HEAD"])).trim();
}

export async function clearWorktree(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true });
}

function refNotFoundFromError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  return (
    /Remote branch .+ not found/i.test(msg) ||
    /couldn't find remote ref/i.test(msg) ||
    /not a tree/i.test(msg) ||
    /unknown revision or path/i.test(msg)
  );
}

function injectToken(url: string, token: string): string {
  if (!url.startsWith("https://")) return url;
  const after = url.slice("https://".length);
  return `https://x-access-token:${token}@${after}`;
}

async function tryReadOriginUrl(workDir: string): Promise<string> {
  try {
    const git = simpleGit(workDir);
    const remotes = await git.getRemotes(true);
    return remotes.find((r) => r.name === "origin")?.refs.fetch ?? "";
  } catch {
    return "";
  }
}
