import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXIT_DECLINED,
  EXIT_INTERRUPTED,
  EXIT_OK,
  EXIT_REFUSED,
  runDocumentAdd,
  runDocumentList,
  runDocumentRemove,
  runSourceAdd,
  runSourceList,
  runSourceRemove,
} from "../../../../src/cli/commands/edit.js";
import { type CliContext, buildContext } from "../../../../src/cli/context.js";
import { PromptCancelledError } from "../../../../src/ui/prompts.js";

const CANCEL = Symbol("cancel");
type Validated = { validate?: (v: string) => string | undefined };

let root: string;
let messages: string[];
let stdout: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "maester-editcli-"));
  messages = [];
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

/** A real context whose prompts replay `answers` in order. */
function ctxWith(answers: unknown[]): CliContext {
  const ctx = buildContext({ noWelcome: true }, root);
  const next = () => {
    if (answers.length === 0) throw new Error("ran out of scripted answers");
    const answer = answers.shift();
    if (answer === CANCEL) throw new PromptCancelledError();
    return answer;
  };
  const record = (m: string) => {
    messages.push(m);
  };
  ctx.prompts = {
    ...ctx.prompts,
    intro: record,
    outro: record,
    note: (title: string, body?: string) => record(`${title}: ${body ?? ""}`),
    log: { message: record, success: record, warning: record, error: record, info: record },
    text: async (opts: Validated) => {
      const answer = next() as string;
      const problem = opts.validate?.(answer);
      if (problem) throw new Error(`scripted answer '${answer}' rejected: ${problem}`);
      return answer;
    },
    select: async () => next(),
    confirm: async () => next(),
  } as unknown as CliContext["prompts"];
  ctx.logger = { ...ctx.logger, error: record } as CliContext["logger"];
  return ctx;
}

const CITADEL = `schemaVersion: 1
baseDir: kb
# sources below
sources:
  - name: design
    url: https://example.com/design.git
    ref: main
    description: Design system docs
  - name: notes
    path: ../notes
    tags: [internal]
`;
const MAESTER = `schemaVersion: 1
documents:
  - path: README.md
    category: readme
    state: canon
  - path: docs/adr/**
    description: Decision records
`;

const write = (name: string, text: string) => fs.writeFile(path.join(root, name), text, "utf8");
const read = (name: string) => fs.readFile(path.join(root, name), "utf8");
// name, kind, url, ref, explicit includes?, auth, destination, description, tags
const GIT_SOURCE = [
  "react",
  "git",
  "https://github.com/facebook/react.git",
  "",
  false,
  "public",
  "",
  "",
  "",
];

describe("maester add / remove / list (citadel sources)", () => {
  it("add appends via the init prompts and points to sync", async () => {
    await write("citadel.yaml", CITADEL);
    expect(await runSourceAdd(ctxWith([...GIT_SOURCE, true]))).toBe(EXIT_OK);
    expect(await read("citadel.yaml")).toBe(
      `${CITADEL}  - name: react\n    url: https://github.com/facebook/react.git\n`,
    );
    expect(messages.join("\n")).toMatch(/Run `maester sync`/);
  });

  it("add rejects a name already in use (same validator as init)", async () => {
    await write("citadel.yaml", CITADEL);
    await expect(runSourceAdd(ctxWith(["design"]))).rejects.toThrow(/already used/);
  });

  it("add leaves the file untouched when declined (exit 1) or cancelled (exit 130)", async () => {
    await write("citadel.yaml", CITADEL);
    expect(await runSourceAdd(ctxWith([...GIT_SOURCE, false]))).toBe(EXIT_DECLINED);
    expect(await runSourceAdd(ctxWith(["react", "git", CANCEL]))).toBe(EXIT_INTERRUPTED);
    expect(await read("citadel.yaml")).toBe(CITADEL);
  });

  it("add refuses a destination that collides with an existing source", async () => {
    await write("citadel.yaml", CITADEL);
    const answers = [...GIT_SOURCE];
    answers[6] = "kb/design";
    expect(await runSourceAdd(ctxWith([...answers]))).toBe(EXIT_REFUSED);
    expect(await read("citadel.yaml")).toBe(CITADEL);
  });

  it("refuses with exit 2 and an init hint when citadel.yaml is missing", async () => {
    expect(await runSourceAdd(ctxWith([]))).toBe(EXIT_REFUSED);
    expect(await runSourceList(ctxWith([]))).toBe(EXIT_REFUSED);
    expect(messages.join("\n")).toMatch(/maester init/);
  });

  it("remove restates the entry, removes it, and notes leftover output", async () => {
    await write("citadel.yaml", CITADEL);
    await fs.mkdir(path.join(root, "kb/design"), { recursive: true });
    expect(await runSourceRemove(ctxWith(["0", true]))).toBe(EXIT_OK);
    const text = await read("citadel.yaml");
    expect(text).not.toContain("design");
    expect(text).toContain("# sources below");
    const log = messages.join("\n");
    expect(log).toMatch(
      /name: design\nfrom: https:\/\/example.com\/design.git @ main\ndescription: Design system docs/,
    );
    expect(log).toMatch(/not removed automatically/);
  });

  it("remove declined → exit 1, file unchanged", async () => {
    await write("citadel.yaml", CITADEL);
    expect(await runSourceRemove(ctxWith(["1", false]))).toBe(EXIT_DECLINED);
    expect(await read("citadel.yaml")).toBe(CITADEL);
  });

  it("remove refuses the last source", async () => {
    await write(
      "citadel.yaml",
      "schemaVersion: 1\nsources:\n  - name: only\n    url: https://x.example/r.git\n",
    );
    expect(await runSourceRemove(ctxWith([]))).toBe(EXIT_REFUSED);
    expect(messages.join("\n")).toMatch(/at least one source/);
  });

  it("list renders every source with defaults spelled out, plus count and path", async () => {
    await write("citadel.yaml", `${CITADEL}mystery: true\n`);
    expect(await runSourceList(ctxWith([]))).toBe(EXIT_OK);
    const out = stdout.join("");
    expect(out).toMatch(
      /design.*https:\/\/example.com\/design.git.*main.*none.*kb\/design \(default\)/,
    );
    expect(out).toMatch(/notes.*\.\.\/notes.*—.*none.*kb\/notes \(default\).*internal/);
    expect(out).toContain(`2 sources in ${path.join(root, "citadel.yaml")}`);
    expect(messages.join("\n")).toMatch(/Unrecognized top-level field 'mystery'/);
  });
});

// path, state, description, category, tags
const DOC = ["docs/runbooks/**/*.md", "canon", "", "runbook", ""];

describe("maester publish add / remove / list (maester documents)", () => {
  it("add appends a document", async () => {
    await write("maester.yaml", MAESTER);
    expect(await runDocumentAdd(ctxWith([...DOC, true]))).toBe(EXIT_OK);
    expect(await read("maester.yaml")).toBe(
      `${MAESTER}  - path: docs/runbooks/**/*.md\n    category: runbook\n    state: canon\n`,
    );
  });

  it("add rejects a path already in the manifest", async () => {
    await write("maester.yaml", MAESTER);
    await expect(runDocumentAdd(ctxWith(["README.md"]))).rejects.toThrow(/already declared/);
  });

  it("add to a whole-repository manifest warns that publishing narrows", async () => {
    await write("maester.yaml", "schemaVersion: 1\ndocuments: []\n");
    expect(await runDocumentAdd(ctxWith([...DOC, true]))).toBe(EXIT_OK);
    expect(messages.join("\n")).toMatch(/publishes only the documents it lists/);
  });

  it("remove restates path and description, and refuses the last document", async () => {
    await write("maester.yaml", MAESTER);
    expect(await runDocumentRemove(ctxWith(["1", true]))).toBe(EXIT_OK);
    expect(messages.join("\n")).toMatch(/path: docs\/adr\/\*\*\ndescription: Decision records/);
    expect(await runDocumentRemove(ctxWith([]))).toBe(EXIT_REFUSED);
    expect(messages.join("\n")).toMatch(/WHOLE repository/);
    expect(await read("maester.yaml")).toContain("README.md");
  });

  it("list renders path, category, state, description and tags", async () => {
    await write("maester.yaml", MAESTER);
    expect(await runDocumentList(ctxWith([]))).toBe(EXIT_OK);
    const out = stdout.join("");
    expect(out).toMatch(/README\.md.*readme.*canon/);
    expect(out).toMatch(/docs\/adr\/\*\*.*file header.*Decision records/);
    expect(out).toContain("2 documents in");
  });

  it("refuses with a publish hint when maester.yaml is missing", async () => {
    expect(await runDocumentList(ctxWith([]))).toBe(EXIT_REFUSED);
    expect(messages.join("\n")).toMatch(/maester publish/);
  });
});
