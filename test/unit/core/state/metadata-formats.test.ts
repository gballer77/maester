import { describe, expect, it } from "vitest";
import { handlerFor } from "../../../../src/core/state/format.js";
import { parseCategory, parseTags } from "../../../../src/core/state/schema.js";

const buf = (s: string) => Buffer.from(s, "utf8");

function roundTrip(file: string, input: string, resolved: Parameters<typeof write>[2]) {
  const out = write(file, input, resolved);
  return { out, text: out.toString("utf8"), read: handlerFor(file)?.read(out) };
}

function write(
  file: string,
  input: string,
  resolved: { state: "draft" | "canon"; category?: string; tags?: string[] },
): Buffer {
  const handler = handlerFor(file);
  if (!handler) throw new Error(`no handler for ${file}`);
  return handler.write(buf(input), resolved);
}

describe("parseCategory", () => {
  it("accepts a slug and trims whitespace", () => {
    expect(parseCategory(" spec ")).toEqual({ kind: "valid", value: "spec" });
  });
  it("treats empty and missing as absent", () => {
    expect(parseCategory(undefined)).toEqual({ kind: "absent" });
    expect(parseCategory("")).toEqual({ kind: "absent" });
  });
  it("rejects non-slugs and non-strings", () => {
    expect(parseCategory("Spec Docs")).toEqual({ kind: "invalid", raw: "Spec Docs" });
    expect(parseCategory(["spec"])).toEqual({ kind: "invalid", raw: '["spec"]' });
  });
});

describe("parseTags", () => {
  it("accepts a sequence, keeping order and dropping duplicates", () => {
    expect(parseTags(["api", "public", "api"])).toEqual({
      kind: "valid",
      value: ["api", "public"],
    });
  });
  it("accepts a comma-separated string with trimmed items", () => {
    expect(parseTags("api,  public ")).toEqual({ kind: "valid", value: ["api", "public"] });
  });
  it("treats an empty list as absent", () => {
    expect(parseTags([])).toEqual({ kind: "absent" });
    expect(parseTags("  ")).toEqual({ kind: "absent" });
  });
  it("is invalid as a whole when any item is empty or not a slug", () => {
    expect(parseTags("api,,public")).toEqual({ kind: "invalid", raw: "api,,public" });
    expect(parseTags(["api", "Public"])).toEqual({ kind: "invalid", raw: "api, Public" });
    expect(parseTags("api")).toEqual({ kind: "valid", value: ["api"] });
  });
});

describe("markdown category/tags", () => {
  it("reads both from frontmatter", () => {
    const meta = handlerFor("a.md")?.read(
      buf("---\ncategory: spec\ntags: [api, public]\n---\n# hi\n"),
    );
    expect(meta?.category).toEqual({ kind: "valid", value: "spec" });
    expect(meta?.tags).toEqual({ kind: "valid", value: ["api", "public"] });
  });

  it("writes state, category and tags in that order into new frontmatter", () => {
    const { text } = roundTrip("a.md", "# hi\n", {
      state: "canon",
      category: "spec",
      tags: ["api", "public"],
    });
    expect(text).toBe("---\nstate: canon\ncategory: spec\ntags:\n  - api\n  - public\n---\n# hi\n");
  });

  it("is byte-identical when the values already match", () => {
    const input = buf("---\nstate: draft\ncategory: spec\ntags: [api]\n---\n# hi\n");
    expect(
      handlerFor("a.md")?.write(input, { state: "draft", category: "spec", tags: ["api"] }),
    ).toBe(input);
  });

  it("leaves an existing value alone when the field resolves unset", () => {
    const input = buf("---\nstate: draft\ncategory: Not A Slug\n---\n# hi\n");
    expect(handlerFor("a.md")?.write(input, { state: "draft" })).toBe(input);
  });
});

describe("yaml category/tags", () => {
  it("appends new keys after existing ones and round-trips", () => {
    const { text, read } = roundTrip("a.yaml", "name: x # keep\n", {
      state: "draft",
      category: "config",
      tags: ["infra"],
    });
    expect(text).toBe("name: x # keep\nstate: draft\ncategory: config\ntags:\n  - infra\n");
    expect(read?.tags).toEqual({ kind: "valid", value: ["infra"] });
  });

  it("is byte-identical when the values already match", () => {
    const input = buf("state: draft\ncategory: config\ntags: [infra]\n");
    expect(
      handlerFor("a.yml")?.write(input, { state: "draft", category: "config", tags: ["infra"] }),
    ).toBe(input);
  });

  it("does not touch a top-level sequence", () => {
    const input = buf("- a\n- b\n");
    expect(handlerFor("a.yaml")?.write(input, { state: "draft", category: "x" })).toBe(input);
  });
});

describe("json category/tags", () => {
  it("updates existing keys in place and appends new ones", () => {
    const { text } = roundTrip("a.json", '{\n  "category": "old",\n  "name": "x"\n}\n', {
      state: "canon",
      category: "api",
      tags: ["public"],
    });
    expect(JSON.parse(text)).toEqual({
      category: "api",
      name: "x",
      state: "canon",
      tags: ["public"],
    });
    expect(Object.keys(JSON.parse(text))).toEqual(["category", "name", "state", "tags"]);
  });

  it("is byte-identical when the values already match", () => {
    const input = buf('{"state":"draft","category":"api","tags":["public"]}');
    expect(
      handlerFor("a.json")?.write(input, { state: "draft", category: "api", tags: ["public"] }),
    ).toBe(input);
  });
});

describe("html leading metadata block", () => {
  it("reads consecutive comments before the DOCTYPE in any order", () => {
    const meta = handlerFor("a.html")?.read(
      buf(
        "<!-- tags: api, public -->\n<!-- state: canon -->\n<!-- category: spec -->\n<!DOCTYPE html>\n",
      ),
    );
    expect(meta).toEqual({
      state: { kind: "valid", value: "canon" },
      category: { kind: "valid", value: "spec" },
      tags: { kind: "valid", value: ["api", "public"] },
    });
  });

  it("ignores metadata comments after the block ends", () => {
    const meta = handlerFor("a.html")?.read(
      buf("<!-- state: canon -->\n<!DOCTYPE html>\n<!-- category: spec -->\n"),
    );
    expect(meta?.category).toEqual({ kind: "absent" });
  });

  it("rewrites the block in state, category, tags order", () => {
    const { text } = roundTrip(
      "a.html",
      "<!-- tags: x -->\n<!-- state: draft -->\n<!DOCTYPE html>\n",
      {
        state: "canon",
        category: "spec",
        tags: ["api", "public"],
      },
    );
    expect(text).toBe(
      "<!-- state: canon -->\n<!-- category: spec -->\n<!-- tags: api, public -->\n<!DOCTYPE html>\n",
    );
  });

  it("keeps an unset field's existing line verbatim", () => {
    const { text } = roundTrip(
      "a.html",
      "<!-- state: draft -->\n<!--category:Bad Value-->\n<p>\n",
      {
        state: "canon",
      },
    );
    expect(text).toBe("<!-- state: canon -->\n<!--category:Bad Value-->\n<p>\n");
  });

  it("is byte-identical when the block already matches, and preserves CRLF", () => {
    const input = buf("<!-- state: draft -->\r\n<!-- category: spec -->\r\n<html>\r\n");
    expect(handlerFor("a.htm")?.write(input, { state: "draft", category: "spec" })).toBe(input);
    const { text } = roundTrip("a.html", "<!-- state: draft -->\r\n<html>\r\n", {
      state: "draft",
      tags: ["a"],
    });
    expect(text).toBe("<!-- state: draft -->\r\n<!-- tags: a -->\r\n<html>\r\n");
  });
});

describe("plain-text leading metadata block", () => {
  it("reads and writes the block", () => {
    const { text, read } = roundTrip("a.txt", "Hello\n", {
      state: "draft",
      category: "notes",
      tags: ["a", "b"],
    });
    expect(text).toBe("state: draft\ncategory: notes\ntags: a, b\nHello\n");
    expect(read?.tags).toEqual({ kind: "valid", value: ["a", "b"] });
  });

  it("reports invalid inline tags as a whole", () => {
    expect(handlerFor("a.txt")?.read(buf("tags: a, B\nbody\n")).tags).toEqual({
      kind: "invalid",
      raw: "a, B",
    });
  });

  it("does not add a newline to a block-only file without one", () => {
    const input = buf("state: draft\ncategory: notes");
    expect(handlerFor("a.txt")?.write(input, { state: "draft", category: "notes" })).toBe(input);
  });
});
