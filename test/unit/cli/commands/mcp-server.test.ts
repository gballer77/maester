import { describe, expect, it } from "vitest";
import { describeServer, promptMcpServer } from "../../../../src/cli/commands/mcp-server.js";
import type { CliContext } from "../../../../src/cli/context.js";
import { formatArgv, splitArgs } from "../../../../src/core/mcp/proxy/argv.js";
import { McpServerSchema } from "../../../../src/schemas/citadel.js";

type Validated = { message: string; validate?: (v: string) => string | undefined };

/** Scripted prompts: answers are consumed in order; text answers run through `validate`. */
function scriptedCtx(answers: unknown[], rejected: string[] = []): CliContext {
  const next = () => {
    if (answers.length === 0) throw new Error("ran out of scripted answers");
    return answers.shift();
  };
  const prompts = {
    text: async (opts: Validated) => {
      let answer = next() as string;
      let problem = opts.validate?.(answer);
      while (problem) {
        rejected.push(problem);
        answer = next() as string;
        problem = opts.validate?.(answer);
      }
      return answer;
    },
    select: async () => next(),
    confirm: async () => next(),
  };
  return { prompts } as unknown as CliContext;
}

describe("promptMcpServer", () => {
  it("builds a proxied local server, splitting args with shell quoting", async () => {
    const ctx = scriptedCtx([
      "code-host",
      "local",
      "",
      "proxy",
      "npx",
      `-y "@example/code host" --flag='a b'`,
      "CODE_HOST_TOKEN, OTHER",
    ]);
    const server = await promptMcpServer(ctx, new Set());
    expect(server).toEqual({
      name: "code-host",
      kind: "local",
      command: "npx",
      args: ["-y", "@example/code host", "--flag=a b"],
      envVars: ["CODE_HOST_TOKEN", "OTHER"],
    });
    expect(McpServerSchema.safeParse(server).success).toBe(true);
  });

  it("builds a direct remote server with a custom auth header", async () => {
    const ctx = scriptedCtx([
      "wiki",
      "remote",
      "Team wiki",
      "direct",
      "https://w.example.com/mcp",
      "WIKI_KEY",
      "X-Api-Key",
    ]);
    expect(await promptMcpServer(ctx, new Set())).toEqual({
      name: "wiki",
      kind: "remote",
      description: "Team wiki",
      register: "direct",
      url: "https://w.example.com/mcp",
      auth: { envVar: "WIKI_KEY", header: "X-Api-Key" },
    });
  });

  it("re-asks for taken or reserved names and for pasted secrets, without echoing them", async () => {
    const rejected: string[] = [];
    const secret = "ghp_abcdefSECRET123";
    const ctx = scriptedCtx(
      [
        "gitlab",
        "maester",
        "tracker",
        "remote",
        "",
        "proxy",
        "https://t.example/mcp",
        secret,
        "TRACKER_TOKEN",
        "",
      ],
      rejected,
    );
    const server = await promptMcpServer(ctx, new Set(["gitlab"]));
    expect(server).toMatchObject({ name: "tracker", auth: { envVar: "TRACKER_TOKEN" } });
    expect(rejected).toHaveLength(3);
    expect(rejected.join(" ")).not.toContain(secret);
  });
});

describe("splitArgs / formatArgv", () => {
  it("round-trips quoted arguments and rejects an unclosed quote", () => {
    const argv = splitArgs(`a "b c" 'd "e"' f\\ g ""`);
    expect(argv).toEqual(["a", "b c", 'd "e"', "f g", ""]);
    expect(splitArgs(formatArgv(argv))).toEqual(argv);
    expect(() => splitArgs(`"open`)).toThrow(/unclosed/);
  });
});

describe("describeServer", () => {
  it("shows the exact argv or URL and env-var names only", () => {
    expect(
      describeServer({ name: "r", kind: "remote", url: "https://x/mcp", auth: { envVar: "TOK" } }),
    ).toEqual([
      "r (remote, proxy)",
      "url:  https://x/mcp",
      "auth: Authorization: Bearer $TOK",
      "env:  TOK",
    ]);
  });
});
