import { describe, expect, it } from "vitest";
import { resolveSourceMode } from "../../../../src/core/sources/source-mode.js";

const git = { name: "r", url: "https://x.example/r.git" };
const path = { name: "n", path: "../notes" };

describe("resolveSourceMode", () => {
  it("links whole-repository sources of both kinds", () => {
    expect(resolveSourceMode(git, "whole-repository")).toBe("link");
    expect(resolveSourceMode(path, "whole-repository")).toBe("link");
    expect(resolveSourceMode({ ...path, mode: "link" }, "whole-repository")).toBe("link");
  });

  it("fails an explicit copy request that resolves to whole-repository", () => {
    expect(() => resolveSourceMode({ ...path, mode: "copy" }, "whole-repository")).toThrow(
      /mode: copy .* requires an `includes` list .* or published entries/,
    );
  });

  it("copies git sources and defaults path sources to link otherwise", () => {
    expect(resolveSourceMode(git, "manifest")).toBe("copy");
    expect(resolveSourceMode(path, "includes")).toBe("link");
    expect(resolveSourceMode({ ...path, mode: "copy" }, "manifest")).toBe("copy");
  });
});
