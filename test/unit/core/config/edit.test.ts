import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEntry,
  commitEdit,
  openConfigForEdit,
  removeEntry,
  writeFileAtomic,
} from "../../../../src/core/config/edit.js";
import { ConfigError } from "../../../../src/core/errors.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "maester-edit-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const CITADEL = `# Team citadel — hand-written comment
schemaVersion: 1
baseDir: kb # keep this inline comment

sources:
  # The design system
  - name: design
    url: https://example.com/design.git
    ref: main
  - name: handbook # second source
    url: https://example.com/handbook.git
`;

const write = (name: string, text: string) => fs.writeFile(path.join(root, name), text, "utf8");
const read = (name: string) => fs.readFile(path.join(root, name), "utf8");

describe("config edit engine", () => {
  it("appends a source keeping comments, order, baseDir and schemaVersion", async () => {
    await write("citadel.yaml", CITADEL);
    const handle = await openConfigForEdit(root, "citadel");
    expect(handle.config.sources.map((s) => s.name)).toEqual(["design", "handbook"]);
    appendEntry(handle, { name: "react", url: "https://github.com/facebook/react.git" });
    const config = await commitEdit(handle);
    expect(config.sources).toHaveLength(3);
    expect(await read("citadel.yaml")).toBe(
      `${CITADEL}  - name: react\n    url: https://github.com/facebook/react.git\n`,
    );
  });

  it("removes one source and leaves everything else byte-identical", async () => {
    await write("citadel.yaml", CITADEL);
    const handle = await openConfigForEdit(root, "citadel");
    removeEntry(handle, 1);
    await commitEdit(handle);
    const text = await read("citadel.yaml");
    expect(text).not.toContain("handbook");
    expect(text).toContain("# Team citadel — hand-written comment");
    expect(text).toContain("baseDir: kb # keep this inline comment");
    expect(text).toContain("# The design system");
  });

  it("keeps unknown top-level keys and reports them", async () => {
    await write("citadel.yaml", `${CITADEL}futureField: 42\n`);
    const handle = await openConfigForEdit(root, "citadel");
    expect(handle.unknownKeys).toEqual(["futureField"]);
    removeEntry(handle, 0);
    await commitEdit(handle);
    expect(await read("citadel.yaml")).toContain("futureField: 42");
  });

  it("refuses an edit that breaks validation and leaves the file untouched", async () => {
    await write("citadel.yaml", CITADEL);
    const handle = await openConfigForEdit(root, "citadel");
    appendEntry(handle, { name: "design", url: "https://example.com/dup.git" });
    await expect(commitEdit(handle)).rejects.toThrow(/duplicate name 'design'/);
    expect(await read("citadel.yaml")).toBe(CITADEL);
    expect((await fs.readdir(root)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("grows an empty flow `documents: []` as a block list", async () => {
    await write("maester.yaml", "# whole repo\nschemaVersion: 1\ndocuments: []\n");
    const handle = await openConfigForEdit(root, "maester");
    appendEntry(handle, { path: "README.md", state: "canon" });
    await commitEdit(handle);
    expect(await read("maester.yaml")).toBe(
      "# whole repo\nschemaVersion: 1\ndocuments:\n  - path: README.md\n    state: canon\n",
    );
  });

  it("creates the documents list when it is omitted", async () => {
    await write("maester.yaml", "schemaVersion: 1\n");
    const handle = await openConfigForEdit(root, "maester");
    appendEntry(handle, { path: "docs/a.md" });
    await commitEdit(handle);
    expect(await read("maester.yaml")).toBe("schemaVersion: 1\ndocuments:\n  - path: docs/a.md\n");
  });

  it("reports a missing file with the init / publish hint", async () => {
    await expect(openConfigForEdit(root, "citadel")).rejects.toThrow(/maester init/);
    await expect(openConfigForEdit(root, "maester")).rejects.toThrow(/maester publish/);
  });

  it("surfaces unparseable YAML as a ConfigError", async () => {
    await write("citadel.yaml", "schemaVersion: 1\nsources: [\n");
    await expect(openConfigForEdit(root, "citadel")).rejects.toBeInstanceOf(ConfigError);
  });

  it("keeps the original and removes the temp file when the rename fails", async () => {
    const target = path.join(root, "citadel.yaml");
    await fs.mkdir(target); // renaming a file over a directory fails
    await expect(writeFileAtomic(target, "x")).rejects.toThrow(/original is unchanged/);
    expect((await fs.readdir(root)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
