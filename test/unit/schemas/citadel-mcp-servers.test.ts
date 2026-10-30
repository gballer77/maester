import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __registerTestType } from "../../../src/core/connectors/registry.js";
import { CitadelConfigSchema } from "../../../src/schemas/citadel.js";
import { TEST_CONNECTOR_TYPE_ID, testConnectorType } from "../../fixtures/connector-test-type.js";

const SOURCES = [{ name: "docs", url: "https://example.com/docs.git" }];

function parse(mcpServers: unknown[], extra: Record<string, unknown> = {}) {
  return CitadelConfigSchema.safeParse({
    schemaVersion: 1,
    sources: SOURCES,
    mcpServers,
    ...extra,
  });
}

function issueAt(result: ReturnType<typeof parse>, path: string) {
  return result.success ? undefined : result.error.issues.find((i) => i.path.join(".") === path);
}

let dispose: () => void;
beforeEach(() => {
  dispose = __registerTestType(testConnectorType);
});
afterEach(() => dispose());

describe("CitadelConfigSchema — mcpServers", () => {
  it("accepts local and remote entries with every optional field", () => {
    const result = parse([
      {
        name: "code-host",
        kind: "local",
        command: "npx",
        args: ["-y", "@example/code-host-mcp"],
        envVars: ["CODE_HOST_TOKEN"],
        description: "Code host",
        tools: ["search"],
      },
      {
        name: "tracker",
        kind: "remote",
        url: "https://mcp.tracker.example.com/mcp",
        auth: { envVar: "TRACKER_TOKEN", header: "X-Api-Key" },
        register: "direct",
      },
      { name: "dev", kind: "remote", url: "http://localhost:8080/mcp" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects a url on a local entry and a command on a remote entry, naming the field", () => {
    const result = parse([
      { name: "a", kind: "local", command: "x", url: "https://x" },
      { name: "b", kind: "remote", url: "https://x", command: "y" },
    ]);
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(messages.some((m) => m.startsWith("mcpServers.0") && m.includes("url"))).toBe(true);
    expect(messages.some((m) => m.startsWith("mcpServers.1") && m.includes("command"))).toBe(true);
  });

  it("rejects an unknown register value and an unknown kind", () => {
    expect(
      issueAt(
        parse([{ name: "a", kind: "local", command: "x", register: "both" }]),
        "mcpServers.0.register",
      ),
    ).toBeDefined();
    expect(parse([{ name: "a", kind: "sse", url: "https://x" }]).success).toBe(false);
  });

  it("restricts names to a lowercase identifier of at most 32 characters", () => {
    expect(
      issueAt(parse([{ name: "Code", kind: "local", command: "x" }]), "mcpServers.0.name"),
    ).toBeDefined();
    expect(
      issueAt(parse([{ name: "1abc", kind: "local", command: "x" }]), "mcpServers.0.name"),
    ).toBeDefined();
    expect(
      issueAt(parse([{ name: "a".repeat(33), kind: "local", command: "x" }]), "mcpServers.0.name"),
    ).toBeDefined();
    expect(parse([{ name: "a".repeat(32), kind: "local", command: "x" }]).success).toBe(true);
  });

  it("rejects plain http to a non-local host", () => {
    expect(
      issueAt(
        parse([{ name: "a", kind: "remote", url: "http://example.com/mcp" }]),
        "mcpServers.0.url",
      ),
    ).toBeDefined();
  });

  it("rejects pasted secrets in env-var fields without echoing them", () => {
    const secret = "glpat-SuperSecretValue123";
    const result = parse([
      { name: "a", kind: "local", command: "x", envVars: [secret] },
      { name: "b", kind: "remote", url: "https://x.example", auth: { envVar: secret } },
    ]);
    expect(result.success).toBe(false);
    expect(issueAt(result, "mcpServers.0.envVars.0")).toBeDefined();
    expect(issueAt(result, "mcpServers.1.auth.envVar")).toBeDefined();
    expect(
      JSON.stringify(result.success ? {} : result.error.issues.map((i) => i.message)),
    ).not.toContain(secret);
  });

  it("rejects names shared with a connector, naming both entries", () => {
    const result = parse([{ name: "echoer", kind: "local", command: "x" }], {
      connectors: [{ name: "echoer", type: TEST_CONNECTOR_TYPE_ID, config: { prefix: "p" } }],
    });
    expect(issueAt(result, "mcpServers.0.name")?.message).toMatch(
      /mcpServers\[0\].*connectors\[0\]/,
    );
  });

  it("rejects duplicate server names and reserved names", () => {
    const dup = parse([
      { name: "x", kind: "local", command: "a" },
      { name: "x", kind: "local", command: "b" },
    ]);
    expect(issueAt(dup, "mcpServers.1.name")?.message).toMatch(/mcpServers\[0\]/);
    expect(
      issueAt(parse([{ name: "maester", kind: "local", command: "a" }]), "mcpServers.0.name")
        ?.message,
    ).toMatch(/reserved/);
    expect(
      issueAt(parse([{ name: "citadel", kind: "local", command: "a" }]), "mcpServers.0.name")
        ?.message,
    ).toMatch(/reserved/);
  });

  it("reserves 'maester' as a connector name", () => {
    const result = CitadelConfigSchema.safeParse({
      schemaVersion: 1,
      sources: SOURCES,
      connectors: [{ name: "maester", type: TEST_CONNECTOR_TYPE_ID, config: { prefix: "p" } }],
    });
    expect(issueAt(result, "connectors.0.name")?.message).toMatch(/reserved/);
  });
});
