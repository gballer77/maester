import { execFile as execFileCb } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCb);
const REPO_ROOT = resolve(__dirname, "..", "..");
const BIN_PATH = resolve(REPO_ROOT, "bin/maester.mjs");

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFile("node", [BIN_PATH, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

describe("CLI smoke", () => {
  it("prints help text on --help", async () => {
    const { stdout, code } = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("maester");
    expect(stdout).toContain("--version");
    expect(stdout).toContain("init");
  });

  it("prints version on --version", async () => {
    const { stdout, code } = await run(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints help suggestion when invoked with no args in a non-TTY", async () => {
    const { stdout, code } = await run([]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/maester --help/);
  });

  it("emits no ANSI escapes under NO_COLOR=1", async () => {
    const { stdout, stderr } = await run(["--help"]);
    const combined = stdout + stderr;
    const ESC = String.fromCharCode(0x1b);
    expect(combined).not.toContain(ESC);
  });
});
