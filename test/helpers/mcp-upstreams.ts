import { type Server as HttpServer, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** Absolute path of the stdio fixture server; run it with `process.execPath`. */
export const STDIO_UPSTREAM = fileURLToPath(
  new URL("../fixtures/mcp-upstream.mjs", import.meta.url),
);

export type HttpUpstream = {
  url: string;
  /** Header values seen on requests, keyed by lowercase header name. */
  seenHeaders: Record<string, string | undefined>[];
  close(): Promise<void>;
};

/**
 * A stateless Streamable-HTTP MCP server on 127.0.0.1. When `requireHeader` is
 * set, requests without that exact header value get HTTP 401.
 */
export async function startHttpUpstream(
  options: { tools?: string[]; requireHeader?: { name: string; value: string } } = {},
): Promise<HttpUpstream> {
  const tools = options.tools ?? ["lookup"];
  const seenHeaders: HttpUpstream["seenHeaders"] = [];
  const http: HttpServer = createServer(async (req, res) => {
    seenHeaders.push({ ...(req.headers as Record<string, string | undefined>) });
    const required = options.requireHeader;
    if (required && req.headers[required.name.toLowerCase()] !== required.value) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    const server = new Server(
      { name: "http-fixture", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((name) => ({ name, inputSchema: { type: "object" } })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req2) => ({
      content: [{ type: "text", text: `remote:${req2.params.name}` }],
    }));
    // Stateless mode; the casts work around SDK typings under exactOptionalPropertyTypes.
    const transport = new StreamableHTTPServerTransport(
      {} as ConstructorParameters<typeof StreamableHTTPServerTransport>[0],
    );
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport as Parameters<Server["connect"]>[0]);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    seenHeaders,
    close: () =>
      new Promise((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}
