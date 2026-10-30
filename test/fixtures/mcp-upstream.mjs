#!/usr/bin/env node
// Minimal stdio MCP server used as a proxied upstream in tests.
//   --tools a,b,c   tool names to expose (each echoes its arguments)
//   --hang          never answer (startup timeout)
//   --stderr <msg>  write one stderr line at startup
// Special tool names: `crash` exits; `env` returns the child's env keys; `pid` its pid.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : (argv[i + 1] ?? "");
};
if (argv.includes("--hang")) {
  setInterval(() => {}, 1000);
} else {
  const names = (flag("--tools") ?? "echo").split(",").filter(Boolean);
  const stderrLine = flag("--stderr");
  if (stderrLine) process.stderr.write(`${stderrLine}\n`);
  const server = new Server({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: names.map((name) => ({
      name,
      description: `fixture tool ${name}`,
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === "crash") process.exit(3);
    if (req.params.name === "pid")
      return { content: [{ type: "text", text: String(process.pid) }] };
    if (req.params.name === "env") {
      return { content: [{ type: "text", text: JSON.stringify(Object.keys(process.env).sort()) }] };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ tool: req.params.name, args: req.params.arguments ?? {} }),
        },
      ],
    };
  });
  await server.connect(new StdioServerTransport());
}
