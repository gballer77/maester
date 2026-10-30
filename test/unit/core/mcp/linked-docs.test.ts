import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type LinkedDestination,
  findLinkedDestinations,
  listLinkedDocuments,
  readLinkedDocument,
} from "../../../../src/core/mcp/linked-docs.js";
import { runSync } from "../../../../src/core/sync/runner.js";
import type { CitadelConfig } from "../../../../src/schemas/citadel.js";
import { type TempRepo, makeTmpRepo } from "../../../helpers/tmp-repo.js";

let repo: TempRepo;
let notes: TempRepo;
let config: CitadelConfig;
let linked: LinkedDestination[];

async function put(root: TempRepo, rel: string, contents: string): Promise<void> {
  const path = root.resolve(rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

beforeEach(async () => {
  repo = await makeTmpRepo();
  notes = await makeTmpRepo({ withGit: false, withPackageJson: false });
  await put(notes, "README.md", "# notes\n");
  await put(notes, "guides/setup.md", "setup\n");
  await put(notes, "img.bin", "PNG\u0000data");
  const rel = relative(repo.path, notes.path);
  config = {
    schemaVersion: 1,
    sources: [
      { name: "notes", path: rel, includes: ["**/*"] },
      { name: "copied", path: rel, mode: "copy", includes: ["README.md"] },
    ],
  } as CitadelConfig;
  await runSync(config, { repoRoot: repo.path });
  linked = await findLinkedDestinations(config, repo.path);
});

afterEach(async () => {
  await repo.cleanup();
  await notes.cleanup();
});

describe("findLinkedDestinations", () => {
  it("returns only link-mode destinations", () => {
    expect(linked.map((d) => [d.name, d.destination])).toEqual([["notes", "citadel/notes"]]);
  });
});

describe("listLinkedDocuments", () => {
  it("lists repo-relative citadel paths per source", async () => {
    expect(await listLinkedDocuments(linked, repo.path)).toEqual({
      sources: [
        {
          name: "notes",
          destination: "citadel/notes",
          files: [
            "citadel/notes/README.md",
            "citadel/notes/guides/setup.md",
            "citadel/notes/img.bin",
          ],
        },
      ],
    });
  });

  it("filters by source name", async () => {
    expect((await listLinkedDocuments(linked, repo.path, "other")).sources).toEqual([]);
  });
});

describe("readLinkedDocument", () => {
  it("returns the original's current text", async () => {
    await put(notes, "guides/setup.md", "setup v2\n");
    expect(await readLinkedDocument(linked, repo.path, "citadel/notes/guides/setup.md")).toEqual({
      ok: true,
      text: "setup v2\n",
    });
  });

  it.each([
    ["../outside.md", /outside the citadel repository/],
    ["citadel/copied/README.md", /not inside a linked citadel source/],
    ["citadel/notes/.maester-source.json", /not a linked document/],
    ["citadel/notes/missing.md", /does not exist/],
    ["citadel/notes/img.bin", /binary/],
  ])("refuses %s", async (path, message) => {
    const result = await readLinkedDocument(linked, repo.path, path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("refuses a dangling link", async () => {
    await rm(notes.resolve("README.md"));
    const result = await readLinkedDocument(linked, repo.path, "citadel/notes/README.md");
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/no longer resolves/),
    });
  });

  it("refuses a symlink planted outside a link destination", async () => {
    await mkdir(repo.resolve("elsewhere"), { recursive: true });
    await symlink(notes.resolve("README.md"), repo.resolve("elsewhere/x.md"));
    const result = await readLinkedDocument(linked, repo.path, "elsewhere/x.md");
    expect(result.ok).toBe(false);
  });
});
