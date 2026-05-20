import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCodexMcpEntry } from "../../../../../src/core/mcp/registrations/codex.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-mcp-codex-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const configPath = (): string => path.join(repoRoot, ".codex", "config.toml");

describe("writeCodexMcpEntry", () => {
  it("creates .codex/config.toml with the [mcp_servers.maester] block", async () => {
    const out = await writeCodexMcpEntry(repoRoot);
    expect(out.action).toBe("written");
    const parsed = TOML.parse(await fs.readFile(configPath(), "utf8"));
    expect(parsed.mcp_servers).toEqual({
      maester: { command: "npx", args: ["maester", "mcp"] },
    });
  });

  it("is idempotent on a second write", async () => {
    await writeCodexMcpEntry(repoRoot);
    const out = await writeCodexMcpEntry(repoRoot);
    expect(out.action).toBe("unchanged");
  });

  it("preserves other top-level tables and other mcp_servers entries", async () => {
    await fs.mkdir(path.join(repoRoot, ".codex"), { recursive: true });
    const seed = TOML.stringify({
      model: { name: "gpt-4" },
      mcp_servers: {
        other: { command: "node", args: ["other.js"] },
      },
    });
    await fs.writeFile(configPath(), seed, "utf8");
    await writeCodexMcpEntry(repoRoot);
    const parsed = TOML.parse(await fs.readFile(configPath(), "utf8"));
    expect(parsed.model).toEqual({ name: "gpt-4" });
    expect(parsed.mcp_servers).toEqual({
      other: { command: "node", args: ["other.js"] },
      maester: { command: "npx", args: ["maester", "mcp"] },
    });
  });
});
