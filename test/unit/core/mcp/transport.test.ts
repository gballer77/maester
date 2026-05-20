import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, "../../../../src");

/**
 * Gap 41: MCP servers own stdout. A stray `console.log` inside any connector
 * or MCP module corrupts the JSON-RPC stream and crashes the host's parser.
 * This guard fails the suite if any file under `src/core/connectors` or
 * `src/core/mcp` imports the bare `console` global.
 */
describe("MCP stdout discipline", () => {
  it("no file under src/core/connectors or src/core/mcp uses bare `console.*`", async () => {
    const dirs = [path.join(SRC_ROOT, "core/connectors"), path.join(SRC_ROOT, "core/mcp")];
    const offenders: string[] = [];
    for (const dir of dirs) {
      await walkTs(dir, async (filePath) => {
        const text = await fs.readFile(filePath, "utf8");
        if (/\bconsole\.(log|info|warn|error|debug)\b/.test(text)) {
          offenders.push(path.relative(SRC_ROOT, filePath));
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

async function walkTs(dir: string, visit: (filePath: string) => Promise<void>): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTs(full, visit);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      await visit(full);
    }
  }
}
