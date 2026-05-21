import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCursorMcpEntry } from "../../../../../src/core/mcp/registrations/cursor.js";

let repoRoot: string;
const launch = { command: "/fake/path/to/maester", args: ["mcp"] };

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-mcp-cursor-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("writeCursorMcpEntry", () => {
  it("creates .cursor/mcp.json with the maester entry", async () => {
    const out = await writeCursorMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("written");
    const text = await fs.readFile(path.join(repoRoot, ".cursor", "mcp.json"), "utf8");
    const parsed = JSON.parse(text);
    expect(parsed.mcpServers.maester).toEqual({
      command: "/fake/path/to/maester",
      args: ["mcp"],
    });
  });

  it("is idempotent on a second write", async () => {
    await writeCursorMcpEntry(repoRoot, { launch });
    const out = await writeCursorMcpEntry(repoRoot, { launch });
    expect(out.action).toBe("unchanged");
  });

  it("preserves other mcpServers entries", async () => {
    await fs.mkdir(path.join(repoRoot, ".cursor"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, ".cursor", "mcp.json"),
      `${JSON.stringify({ mcpServers: { vendor: { command: "x" } } }, null, 2)}\n`,
      "utf8",
    );
    await writeCursorMcpEntry(repoRoot, { launch });
    const parsed = JSON.parse(
      await fs.readFile(path.join(repoRoot, ".cursor", "mcp.json"), "utf8"),
    );
    expect(parsed.mcpServers.vendor).toEqual({ command: "x" });
    expect(parsed.mcpServers.maester).toBeDefined();
  });

  it("never injects connector env-var names into the env block (Cursor has no working pass-through)", async () => {
    // Even though connectorEnvVars would be passed to other writers, the
    // Cursor adapter discards them — it always sends an empty managed set to
    // the shared JSON writer. The user is instead steered via the Cursor
    // Grand Maester artifact's required-env-vars note.
    await writeCursorMcpEntry(repoRoot, { launch, connectorEnvVars: ["GITLAB_TOKEN"] });
    const parsed = JSON.parse(
      await fs.readFile(path.join(repoRoot, ".cursor", "mcp.json"), "utf8"),
    );
    expect(parsed.mcpServers.maester.env).toBeUndefined();
  });

  it("preserves user-added env entries in .cursor/mcp.json on refresh", async () => {
    await fs.mkdir(path.join(repoRoot, ".cursor"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, ".cursor", "mcp.json"),
      `${JSON.stringify(
        {
          mcpServers: {
            maester: { command: "old", args: [], env: { MY_DEBUG: "1" } },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeCursorMcpEntry(repoRoot, { launch });
    const parsed = JSON.parse(
      await fs.readFile(path.join(repoRoot, ".cursor", "mcp.json"), "utf8"),
    );
    expect(parsed.mcpServers.maester).toEqual({
      command: "/fake/path/to/maester",
      args: ["mcp"],
      env: { MY_DEBUG: "1" },
    });
  });
});
