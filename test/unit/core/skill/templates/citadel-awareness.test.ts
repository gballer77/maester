import { describe, expect, it } from "vitest";
import { renderClaudeSkillBody } from "../../../../../src/core/skill/templates/shells/claude-code.js";

describe("citadel-awareness template", () => {
  it("explains linked sources without listing any source", () => {
    const body = renderClaudeSkillBody({ baseDir: "citadel" });
    expect(body).toContain("may be **linked** rather than mirrored");
    expect(body).toContain("A link that does not resolve means the source has moved");
    expect(body).toContain("maester status");
  });

  it("describes sources as a git remote or a local directory", () => {
    expect(renderClaudeSkillBody({ baseDir: "kb" })).toContain(
      "a git remote\n  (and the ref it pins to) or a local directory on this machine",
    );
  });
});
