import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCodexMcpEntry } from "../../../../../src/core/mcp/registrations/codex.js";

let repoRoot: string;
const launch = { command: "/fake/path/to/maester", args: ["mcp"] };

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-mcp-codex-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const configPath = (): string => path.join(repoRoot, ".codex", "config.toml");

describe("writeCodexMcpEntry", () => {
  it("creates <repo>/.codex/config.toml with [mcp_servers.maester] including cwd and the resolved command", async () => {
    const out = await writeCodexMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("written");
    expect(out.filePath).toBe(configPath());
    const parsed = TOML.parse(await fs.readFile(configPath(), "utf8"));
    expect(parsed.mcp_servers).toEqual({
      maester: { command: "/fake/path/to/maester", args: ["mcp"], cwd: repoRoot },
    });
  });

  it("is idempotent on a second write", async () => {
    await writeCodexMcpEntry(repoRoot, { launch });
    const out = await writeCodexMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("unchanged");
  });

  it("preserves other top-level tables and other mcp_servers entries", async () => {
    await fs.mkdir(path.join(repoRoot, ".codex"), { recursive: true });
    const seed = TOML.stringify({
      model: { name: "gpt-4" },
      mcp_servers: { other: { command: "node", args: ["other.js"] } },
    });
    await fs.writeFile(configPath(), seed, "utf8");
    await writeCodexMcpEntry(repoRoot, { launch });
    const parsed = TOML.parse(await fs.readFile(configPath(), "utf8"));
    expect(parsed.model).toEqual({ name: "gpt-4" });
    expect(parsed.mcp_servers).toEqual({
      other: { command: "node", args: ["other.js"] },
      maester: { command: "/fake/path/to/maester", args: ["mcp"], cwd: repoRoot },
    });
  });

  it("rewrites a stale maester block (e.g. when the binary path changes)", async () => {
    await writeCodexMcpEntry(repoRoot, {
      launch: { command: "/old/path/maester", args: ["mcp"] },
    });
    const out = await writeCodexMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("written");
    const parsed = TOML.parse(await fs.readFile(configPath(), "utf8"));
    expect(parsed.mcp_servers).toEqual({
      maester: { command: "/fake/path/to/maester", args: ["mcp"], cwd: repoRoot },
    });
  });
});
