import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeClaudeCodeMcpEntry } from "../../../../../src/core/mcp/registrations/claude-code.js";

let repoRoot: string;
const launch = { command: "/fake/path/to/maester", args: ["mcp"] };

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-mcp-cc-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("writeClaudeCodeMcpEntry", () => {
  it("creates .mcp.json with the maester entry on a fresh repo", async () => {
    const out = await writeClaudeCodeMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("written");
    const text = await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8");
    const parsed = JSON.parse(text);
    expect(parsed.mcpServers.maester).toEqual({
      command: "/fake/path/to/maester",
      args: ["mcp"],
    });
  });

  it("is idempotent — second identical write returns 'unchanged'", async () => {
    await writeClaudeCodeMcpEntry(repoRoot, { launch });
    const first = await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8");
    const out = await writeClaudeCodeMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("unchanged");
    const second = await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8");
    expect(second).toBe(first);
  });

  it("preserves other mcpServers entries", async () => {
    const existing = JSON.stringify(
      {
        mcpServers: {
          other: { command: "node", args: ["other.js"] },
          maester: { command: "stale", args: [] },
        },
      },
      null,
      2,
    );
    await fs.writeFile(path.join(repoRoot, ".mcp.json"), `${existing}\n`, "utf8");
    await writeClaudeCodeMcpEntry(repoRoot, { launch });
    const parsed = JSON.parse(await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8"));
    expect(parsed.mcpServers.other).toEqual({ command: "node", args: ["other.js"] });
    expect(parsed.mcpServers.maester).toEqual({
      command: "/fake/path/to/maester",
      args: ["mcp"],
    });
  });

  it("preserves other top-level keys", async () => {
    await fs.writeFile(
      path.join(repoRoot, ".mcp.json"),
      `${JSON.stringify({ globalSettings: { foo: true }, mcpServers: {} }, null, 2)}\n`,
      "utf8",
    );
    await writeClaudeCodeMcpEntry(repoRoot, { launch });
    const parsed = JSON.parse(await fs.readFile(path.join(repoRoot, ".mcp.json"), "utf8"));
    expect(parsed.globalSettings).toEqual({ foo: true });
    expect(parsed.mcpServers.maester).toBeDefined();
  });
});
