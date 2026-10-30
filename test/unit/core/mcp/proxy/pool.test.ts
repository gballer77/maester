import { afterEach, describe, expect, it } from "vitest";
import { checkMcpServers, startProxyPool } from "../../../../../src/core/mcp/proxy/pool.js";
import type { ProxyPool } from "../../../../../src/core/mcp/proxy/pool.js";
import type { McpServer } from "../../../../../src/schemas/citadel.js";
import {
  type HttpUpstream,
  STDIO_UPSTREAM,
  startHttpUpstream,
} from "../../../../helpers/mcp-upstreams.js";

const local = (name: string, args: string[] = [], extra: Partial<McpServer> = {}): McpServer =>
  ({
    name,
    kind: "local",
    command: process.execPath,
    args: [STDIO_UPSTREAM, ...args],
    ...extra,
  }) as McpServer;

let pools: ProxyPool[] = [];
let https: HttpUpstream[] = [];
afterEach(async () => {
  for (const p of pools) await p.shutdown();
  for (const h of https) await h.close();
  pools = [];
  https = [];
});

function start(servers: McpServer[], env: Record<string, string> = {}, timeoutMs = 10_000) {
  const logs: string[] = [];
  const pool = startProxyPool(servers, env, { log: (l) => logs.push(l), timeoutMs });
  pools.push(pool);
  return { pool, logs };
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? "";

describe("startProxyPool", () => {
  it("exposes namespaced tools with schemas passed through and forwards the original name", async () => {
    const { pool } = start([local("code-host", ["--tools", "Search.Issues,get"])]);
    const reports = await pool.ready;
    expect(reports[0]?.ok).toBe(true);
    const tools = pool.listTools();
    expect(tools.map((t) => t.name)).toEqual(["code_host__search_issues", "code_host__get"]);
    expect(tools[0]?.description).toBe("fixture tool Search.Issues");
    expect(tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
    });
    const result = await pool.callTool("code_host__search_issues", { text: "hi" });
    expect(JSON.parse(text(result))).toEqual({ tool: "Search.Issues", args: { text: "hi" } });
    expect(pool.callTool("nope__x", {})).toBeUndefined();
  }, 20_000);

  it("passes only the declared env vars (plus the SDK default set) to a local child", async () => {
    const { pool } = start(
      [local("a", ["--tools", "env"], { envVars: ["CODE_TOKEN"] } as Partial<McpServer>)],
      {
        CODE_TOKEN: "v",
        OTHER_SECRET: "leak",
      },
    );
    await pool.ready;
    const keys = JSON.parse(text(await pool.callTool("a__env", {})));
    expect(keys).toContain("CODE_TOKEN");
    expect(keys).not.toContain("OTHER_SECRET");
  }, 20_000);

  it("applies the allowlist and warns about names the server does not offer", async () => {
    const { pool, logs } = start([
      local("a", ["--tools", "one,two"], { tools: ["two", "three"] } as Partial<McpServer>),
    ]);
    const [report] = await pool.ready;
    expect(pool.listTools().map((t) => t.name)).toEqual(["a__two"]);
    expect(report?.warnings).toEqual([{ type: "allowlist-miss", tool: "three" }]);
    expect(logs.some((l) => l.includes("allowlist-miss") && l.includes("three"))).toBe(true);
  }, 20_000);

  it("keeps the first of two tools that normalize to the same name", async () => {
    const { pool } = start([local("a", ["--tools", "Get,get"])]);
    const [report] = await pool.ready;
    expect(pool.listTools().map((t) => t.upstreamName)).toEqual(["Get"]);
    expect(report?.warnings[0]?.type).toBe("name-collision");
  }, 20_000);

  it("degrades a failing server without touching the others", async () => {
    const { pool, logs } = start(
      [
        local("good", ["--tools", "ok"]),
        local("needs-env", [], { envVars: ["MISSING_TOKEN"] } as Partial<McpServer>),
        { name: "nocmd", kind: "local", command: "definitely-not-a-command-xyz" } as McpServer,
        local("slow", ["--hang"]),
      ],
      {},
      1_500,
    );
    const reports = await pool.ready;
    const byName = Object.fromEntries(reports.map((r) => [r.server, r]));
    expect(byName.good?.ok).toBe(true);
    expect(byName["needs-env"]).toMatchObject({
      ok: false,
      failure: { reason: "missing-env-var", detail: "MISSING_TOKEN" },
    });
    expect(byName.nocmd).toMatchObject({ ok: false, failure: { reason: "command-not-found" } });
    expect(byName.slow).toMatchObject({ ok: false, failure: { reason: "timeout" } });
    expect(pool.listTools().map((t) => t.name)).toEqual(["good__ok"]);
    expect(logs).toContain("[mcp-server:needs-env] failed: missing-env-var MISSING_TOKEN");
  }, 20_000);

  it("returns an isError result after a server exits mid-session; other tools keep working", async () => {
    const { pool, logs } = start([
      local("flaky", ["--tools", "crash,echo"]),
      local("steady", ["--tools", "echo"]),
    ]);
    await pool.ready;
    const crashed = await pool.callTool("flaky__crash", {});
    expect(crashed?.isError).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    const after = await pool.callTool("flaky__echo", {});
    expect(after?.isError).toBe(true);
    expect(text(after)).toMatch(/MCP server 'flaky' is unavailable: exited/);
    expect(logs.some((l) => l.includes("[mcp-server:flaky] exited"))).toBe(true);
    expect((await pool.callTool("steady__echo", {}))?.isError).toBeUndefined();
  }, 20_000);

  it("prefixes child stderr lines with the server name", async () => {
    const { pool, logs } = start([local("noisy", ["--stderr", "hello from child"])]);
    await pool.ready;
    await new Promise((r) => setTimeout(r, 100));
    expect(logs).toContain("[mcp-server:noisy] hello from child");
  }, 20_000);

  it("terminates local children on shutdown", async () => {
    const { pool } = start([local("a", ["--tools", "pid"])]);
    await pool.ready;
    const pid = Number(text(await pool.callTool("a__pid", {})));
    expect(() => process.kill(pid, 0)).not.toThrow();
    await pool.shutdown();
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(pid, 0)).toThrow();
    expect((await pool.callTool("a__pid", {}))?.isError).toBe(true);
  }, 20_000);

  it("skips direct servers entirely", async () => {
    const { pool } = start([local("d", [], { register: "direct" } as Partial<McpServer>)]);
    expect(await pool.ready).toEqual([]);
  });

  it("connects to a remote server with a bearer token, and reports auth failures", async () => {
    const http = await startHttpUpstream({
      requireHeader: { name: "Authorization", value: "Bearer s3cret" },
    });
    https.push(http);
    const remote = (name: string, envVar: string) =>
      ({ name, kind: "remote", url: http.url, auth: { envVar } }) as McpServer;
    const { pool } = start([remote("tracker", "GOOD_TOKEN"), remote("wrong", "BAD_TOKEN")], {
      GOOD_TOKEN: "s3cret",
      BAD_TOKEN: "nope",
    });
    const reports = await pool.ready;
    expect(reports[0]?.ok).toBe(true);
    expect(reports[1]).toMatchObject({ ok: false, failure: { reason: "auth-failed" } });
    expect(text(await pool.callTool("tracker__lookup", {}))).toBe("remote:lookup");
  }, 20_000);

  it("sends a custom header without the Bearer prefix", async () => {
    const http = await startHttpUpstream({ requireHeader: { name: "X-Api-Key", value: "k" } });
    https.push(http);
    const { pool } = start(
      [
        {
          name: "r",
          kind: "remote",
          url: http.url,
          auth: { envVar: "K", header: "X-Api-Key" },
        } as McpServer,
      ],
      { K: "k" },
    );
    expect((await pool.ready)[0]?.ok).toBe(true);
  }, 20_000);

  it("reports connection-refused for a dead remote", async () => {
    const http = await startHttpUpstream();
    await http.close();
    const { pool } = start([{ name: "dead", kind: "remote", url: http.url } as McpServer]);
    expect((await pool.ready)[0]).toMatchObject({
      ok: false,
      failure: { reason: "connection-refused" },
    });
  }, 20_000);
});

describe("checkMcpServers", () => {
  it("reports per server, lists direct servers as host-managed, and closes every client", async () => {
    const report = await checkMcpServers(
      {
        mcpServers: [
          local("a", ["--tools", "x,y"]),
          local("b", [], { envVars: ["NOPE"] } as Partial<McpServer>),
          {
            name: "wiki",
            kind: "remote",
            url: "https://w.example/mcp",
            register: "direct",
          } as McpServer,
        ],
      },
      {},
    );
    expect(report.servers.map((s) => ("direct" in s ? "direct" : s.ok))).toEqual([
      true,
      false,
      "direct",
    ]);
    expect(report.proxiedToolCount).toBe(2);
  }, 20_000);

  it("filters by name", async () => {
    const report = await checkMcpServers(
      { mcpServers: [local("a"), local("b")] },
      {},
      { names: ["b"] },
    );
    expect(report.servers.map((s) => s.server)).toEqual(["b"]);
  }, 20_000);
});
