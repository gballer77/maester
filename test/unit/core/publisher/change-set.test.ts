import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitEdit,
  createConfigForEdit,
  openConfigForEdit,
} from "../../../../src/core/config/edit.js";
import {
  type ChangeSet,
  ChangeSetError,
  applyChangeSet,
  parseChangeSet,
} from "../../../../src/core/publisher/change-set.js";

let repoRoot: string;
beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maester-changeset-"));
});
afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

const MANIFEST = `# hand-written header
schemaVersion: 1
documents:
  # the service overview
  - path: README.md
    description: Overview # inline note
    tags: [intro, public]
  - path: docs/adr/*.md
    category: adr
    state: canon
`;

const file = () => path.join(repoRoot, "maester.yaml");

async function apply(set: ChangeSet, { commit = true } = {}) {
  const handle = await openConfigForEdit(repoRoot, "maester");
  const result = await applyChangeSet(handle, set, { repoRoot, existed: true });
  if (commit) await commitEdit(handle);
  return result;
}

async function expectRefused(set: ChangeSet, field: string | RegExp): Promise<void> {
  const before = await fs.readFile(file(), "utf8");
  const err = await apply(set).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ChangeSetError);
  expect((err as ChangeSetError).field).toMatch(field);
  expect(await fs.readFile(file(), "utf8")).toBe(before);
}

describe("applyChangeSet", () => {
  beforeEach(async () => {
    await fs.writeFile(file(), MANIFEST);
  });

  it("applies remove → update → add and keeps comments and untouched entries", async () => {
    const result = await apply({
      remove: ["docs/adr/*.md"],
      update: [{ path: "README.md", set: { category: "overview", tags: ["intro"] } }],
      add: [{ path: "docs/adr/*.md", category: "decision" }],
    });
    expect(result).toMatchObject({
      added: ["docs/adr/*.md"],
      updated: ["README.md"],
      removed: ["docs/adr/*.md"],
    });
    const text = await fs.readFile(file(), "utf8");
    expect(text).toContain("# hand-written header");
    expect(text).toContain("# the service overview");
    expect(text).toContain("description: Overview # inline note");
    expect(text).toContain("tags: [intro]"); // flow style kept
    expect(text).toMatch(/category: overview/);
    expect(text).toMatch(/- path: docs\/adr\/\*\.md\n {4}category: decision/);
  });

  it("unset clears fields; clearing state leaves 'file header'", async () => {
    await apply({ update: [{ path: "docs/adr/*.md", unset: ["state", "category"] }] });
    expect(await fs.readFile(file(), "utf8")).toMatch(/- path: docs\/adr\/\*\.md\n$/);
  });

  it("refuses unknown paths, set+unset of one field, duplicates and empty updates", async () => {
    await expectRefused({ remove: ["nope.md"] }, "remove");
    await expectRefused({ update: [{ path: "nope.md", set: { category: "x" } }] }, "update.0.path");
    await expectRefused(
      { update: [{ path: "README.md", set: { category: "x" }, unset: ["category"] }] },
      "update.0",
    );
    await expectRefused({ update: [{ path: "README.md" }] }, "update.0");
    await expectRefused({ add: [{ path: "README.md" }] }, "add.0.path");
  });

  it("refuses schema-invalid results with the offending field and writes nothing", async () => {
    await expectRefused(
      { update: [{ path: "README.md", set: { category: "Not A Slug" } }] },
      /category$/,
    );
  });

  it("refuses removing the last entry", async () => {
    await expectRefused({ remove: ["README.md", "docs/adr/*.md"] }, "remove");
  });

  it("refuses literal and glob-resolved sensitive paths unless allowSensitive", async () => {
    await fs.mkdir(path.join(repoRoot, "config/secrets"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "config/secrets/token.txt"), "x");
    await expectRefused({ add: [{ path: ".env" }] }, "add.0.path");
    await expectRefused({ add: [{ path: "config/**" }] }, "add.0.path");
    await apply({ add: [{ path: "config/**" }], allowSensitive: true });
    expect(await fs.readFile(file(), "utf8")).toContain("config/**");
  });

  it("dry run (no commit) leaves the file untouched", async () => {
    const before = await fs.readFile(file(), "utf8");
    const result = await apply({ add: [{ path: "CHANGELOG.md" }] }, { commit: false });
    expect(result.documents).toHaveLength(3);
    expect(await fs.readFile(file(), "utf8")).toBe(before);
  });
});

describe("narrowing acknowledgement and create mode", () => {
  it("requires acknowledgeNarrowing for a whole-repository manifest", async () => {
    await fs.writeFile(file(), "schemaVersion: 1\ndocuments: []\n");
    await expectRefused({ add: [{ path: "README.md" }] }, "acknowledgeNarrowing");
    await apply({ add: [{ path: "README.md" }], acknowledgeNarrowing: true });
    expect(await fs.readFile(file(), "utf8")).toMatch(/documents:\n {2}- path: README\.md/);
  });

  it("creates maester.yaml with the header, and still requires the acknowledgement", async () => {
    const refused = createConfigForEdit(repoRoot, "maester");
    await expect(
      applyChangeSet(refused, { add: [{ path: "README.md" }] }, { repoRoot, existed: false }),
    ).rejects.toMatchObject({ field: "acknowledgeNarrowing" });

    const handle = createConfigForEdit(repoRoot, "maester");
    await applyChangeSet(
      handle,
      { add: [{ path: "README.md", state: "canon" }], acknowledgeNarrowing: true },
      { repoRoot, existed: false },
    );
    await commitEdit(handle);
    const text = await fs.readFile(file(), "utf8");
    expect(text).toMatch(/^# maester\.yaml\n/);
    expect(text).toMatch(
      /schemaVersion: 1\ndocuments:\n {2}- path: README\.md\n {4}state: canon\n$/,
    );
  });
});

describe("parseChangeSet", () => {
  it("rejects bad JSON, unknown keys and empty sets with a field", () => {
    expect(() => parseChangeSet("{")).toThrow(/not valid JSON/);
    expect(() => parseChangeSet('{"add":[{"path":"a","bogus":1}]}')).toThrow(ChangeSetError);
    expect(() => parseChangeSet("{}")).toThrow(/at least one/);
    expect(() => parseChangeSet('{"update":[{"path":"a","unset":["path"]}]}')).toThrow(
      ChangeSetError,
    );
    expect(parseChangeSet('{"remove":["a"]}')).toEqual({ remove: ["a"] });
  });
});
