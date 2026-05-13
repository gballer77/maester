import { execFile as execFileCb } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const REPO_ROOT = resolve(__dirname, "..", "..");

export default async function setup(): Promise<void> {
  await execFile("pnpm", ["run", "build"], { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 });
}
