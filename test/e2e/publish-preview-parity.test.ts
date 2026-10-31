import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PreviewReport } from "../../src/core/publisher/preview.js";
import { handlerFor } from "../../src/core/state/format.js";

/**
 * Gap 82: `maester publish preview` must predict exactly what a sync stamps.
 * A citadel pulls this maester through a `path:` source in copy mode (which
 * writes inline metadata into each copied file); every previewed file's
 * state / category / tags must match the synced copy.
 */
const execFile = promisify(execFileCb);
const BIN_PATH = path.resolve(import.meta.dirname, "../../bin/maester.mjs");

async function cli(args: string[], cwd: string) {
  return execFile("node", [BIN_PATH, ...args], { cwd, env: { ...process.env, NO_COLOR: "1" } });
}

let root: string;
const maester = () => path.join(root, "service");
const citadel = () => path.join(root, "kb");

async function write(dir: string, rel: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), text);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "maester-parity-"));
  await write(maester(), "README.md", "# Service\n");
  await write(maester(), "docs/adr/0001.md", "---\nstate: draft\ntags: [rfc]\n---\n# A\n");
  await write(maester(), "docs/guides/start.md", "---\ncategory: tutorial\n---\n# G\n");
  await write(maester(), "docs/api.yaml", "openapi: 3.1.0\n");
  await write(
    maester(),
    "maester.yaml",
    [
      "schemaVersion: 1",
      "documents:",
      "  - path: README.md",
      "    state: canon",
      "    category: overview",
      "  - path: docs/adr/*.md",
      "    category: adr",
      "    state: canon",
      "  - path: docs/**/*",
      "    category: docs",
      "    tags: [internal]",
      "",
    ].join("\n"),
  );
  await write(
    citadel(),
    "citadel.yaml",
    "schemaVersion: 1\nsources:\n  - name: service\n    path: ../service\n    mode: copy\n",
  );
  await write(citadel(), "package.json", "{}\n");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("publish preview ↔ sync parity", () => {
  it("predicts the files and the metadata a copy-mode sync writes", async () => {
    const { stdout } = await cli(["--json", "publish", "preview"], maester());
    const report = JSON.parse(stdout) as PreviewReport;
    if (report.manifest !== "listed") throw new Error("expected a listed manifest");
    const previewed = new Map(report.entries.flatMap((e) => e.files.map((f) => [f.path, f])));

    await cli(["sync"], citadel());
    const dest = path.join(citadel(), "citadel/service");
    const synced = (await fs.readdir(dest, { recursive: true, withFileTypes: true }))
      .filter((d) => d.isFile() && !d.name.startsWith(".maester"))
      .map((d) => path.relative(dest, path.join(d.parentPath, d.name)).split(path.sep).join("/"))
      // The source's own manifest is copied as a sync artifact, not a published
      // document — the metadata applier skips it too.
      .filter((p) => p !== "maester.yaml")
      .sort();
    expect(synced).toEqual([...previewed.keys()].sort());

    for (const [file, p] of previewed) {
      const handler = handlerFor(file);
      if (!handler) {
        expect(p.state).toBe("untagged");
        continue;
      }
      const stamped = handler.read(await fs.readFile(path.join(dest, file)));
      expect({ file, state: stamped.state }).toEqual({
        file,
        state: { kind: "valid", value: p.state },
      });
      expect({ file, category: stamped.category }).toEqual({
        file,
        category: p.category ? { kind: "valid", value: p.category } : { kind: "absent" },
      });
      expect({ file, tags: stamped.tags }).toEqual({
        file,
        tags: p.tags ? { kind: "valid", value: p.tags } : { kind: "absent" },
      });
    }
    // sanity: the interesting cases are really exercised
    expect(previewed.get("docs/adr/0001.md")).toMatchObject({
      state: "draft",
      category: "adr",
      tags: ["rfc"],
    });
    expect(previewed.get("docs/guides/start.md")?.category).toBe("tutorial");
  });
});
