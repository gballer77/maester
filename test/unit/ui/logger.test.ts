import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, redactUrl } from "../../../src/ui/logger.js";
import { createTheming } from "../../../src/ui/theme/index.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`);

function captureStream(): { stream: PassThrough; output: () => string } {
  const stream = new PassThrough();
  let buf = "";
  stream.on("data", (chunk: Buffer | string) => {
    buf += chunk.toString();
  });
  return { stream, output: () => buf };
}

function makeLogger(opts: {
  json?: boolean;
  level?: "silent" | "error" | "warn" | "info" | "verbose";
  noColor?: boolean;
}) {
  const theming = createTheming({
    env: opts.noColor ? { NO_COLOR: "1" } : { COLORTERM: "truecolor" },
    isTTY: !opts.noColor,
    unicodeOverride: true,
  });
  const out = captureStream();
  const err = captureStream();
  const logger = createLogger({
    theming,
    ...(opts.level !== undefined ? { level: opts.level } : {}),
    ...(opts.json !== undefined ? { json: opts.json } : {}),
    stdout: out.stream,
    stderr: err.stream,
  });
  return { logger, out, err };
}

describe("createLogger (human mode)", () => {
  it("prefixes success messages with ✓ glyph", () => {
    const { logger, out } = makeLogger({});
    logger.success("done");
    expect(out.output()).toContain("✓");
    expect(out.output()).toContain("done");
  });

  it("prefixes error messages and routes them to stderr", () => {
    const { logger, out, err } = makeLogger({});
    logger.error("boom");
    expect(err.output()).toContain("✗");
    expect(err.output()).toContain("boom");
    expect(out.output()).toBe("");
  });

  it("emits no ANSI sequences when NO_COLOR is set", () => {
    const { logger, out } = makeLogger({ noColor: true });
    logger.success("done");
    expect(out.output()).not.toMatch(ANSI_RE);
  });

  it("respects level=silent", () => {
    const { logger, out, err } = makeLogger({ level: "silent" });
    logger.success("done");
    logger.error("boom");
    expect(out.output()).toBe("");
    expect(err.output()).toBe("");
  });

  it("suppresses info when level=warn", () => {
    const { logger, out } = makeLogger({ level: "warn" });
    logger.info("noise");
    logger.warning("watch out");
    expect(out.output()).not.toContain("noise");
    expect(out.output()).toContain("watch out");
  });
});

describe("createLogger (json mode)", () => {
  it("emits one JSON object per line with level + message", () => {
    const { logger, out } = makeLogger({ json: true });
    logger.success("clone complete", { source: "design-tokens" });
    const lines = out.output().trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.level).toBe("success");
    expect(parsed.message).toBe("clone complete");
    expect(parsed.source).toBe("design-tokens");
  });

  it("never colors JSON output", () => {
    const { logger, out } = makeLogger({ json: true });
    logger.success("done");
    expect(out.output()).not.toMatch(ANSI_RE);
    expect(out.output()).not.toContain("✓");
  });

  it("routes error-level JSON to stderr", () => {
    const { logger, out, err } = makeLogger({ json: true });
    logger.error("nope");
    expect(out.output()).toBe("");
    const parsed = JSON.parse(err.output().trim());
    expect(parsed.level).toBe("error");
  });
});

describe("redactUrl", () => {
  it("redacts the password segment of https URLs", () => {
    const input = "Failed to fetch https://x-access-token:ghp_secretvalue@github.com/org/repo.git";
    const out = redactUrl(input);
    expect(out).not.toContain("ghp_secretvalue");
    expect(out).toContain("https://x-access-token:***@github.com");
  });

  it("leaves clean URLs unchanged", () => {
    const input = "https://github.com/org/repo.git";
    expect(redactUrl(input)).toBe(input);
  });
});
