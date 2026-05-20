import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCursorMcpEntry } from "../../../../../src/core/mcp/registrations/cursor.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-mcp-cursor-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("writeCursorMcpEntry", () => {
  it("creates .cursor/mcp.json with the maester entry", async () => {
    const out = await writeCursorMcpEntry(repoRoot);
    expect(out.action).toBe("written");
    const text = await fs.readFile(path.join(repoRoot, ".cursor", "mcp.json"), "utf8");
    const parsed = JSON.parse(text);
    expect(parsed.mcpServers.maester).toEqual({ command: "npx", args: ["maester", "mcp"] });
  });

  it("is idempotent on a second write", async () => {
    await writeCursorMcpEntry(repoRoot);
    const out = await writeCursorMcpEntry(repoRoot);
    expect(out.action).toBe("unchanged");
  });

  it("preserves other mcpServers entries", async () => {
    await fs.mkdir(path.join(repoRoot, ".cursor"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, ".cursor", "mcp.json"),
      `${JSON.stringify({ mcpServers: { vendor: { command: "x" } } }, null, 2)}\n`,
      "utf8",
    );
    await writeCursorMcpEntry(repoRoot);
    const parsed = JSON.parse(
      await fs.readFile(path.join(repoRoot, ".cursor", "mcp.json"), "utf8"),
    );
    expect(parsed.mcpServers.vendor).toEqual({ command: "x" });
    expect(parsed.mcpServers.maester).toBeDefined();
  });
});
