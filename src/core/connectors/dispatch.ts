import { z } from "zod";
import type { CitadelConfig, Connector } from "../../schemas/citadel.js";
import { resolveAuth } from "../auth/resolver.js";
import { AuthError } from "../errors.js";
import { buildFailureEnvelope, buildSuccessEnvelope } from "./envelope.js";
import { ConnectorError } from "./errors.js";
import { argsSchemaToJsonSchema } from "./input-schema.js";
import { lookupConnectorType } from "./registry.js";
import { toolName } from "./tool-name.js";
import type {
  ConnectorOperation,
  ConnectorResultEnvelope,
  ConnectorToolDescriptor,
  ConnectorType,
} from "./types.js";

export type InvokeOperationInput = {
  /** The connector entry from `citadel.yaml` (already validated). */
  connector: Connector;
  /** Operation name as it appears on the type (kebab-case, e.g. "list-issues"). */
  operationName: string;
  /** Raw arguments object supplied by the caller (MCP `arguments` or CLI flags). */
  args: unknown;
  /** Optional environment override — defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
};

/**
 * The only call path that runs a connector handler. Both the MCP server
 * (`src/core/mcp/server.ts`) and the fallback CLI (`src/cli/commands/connector.ts`)
 * go through it. Every outcome is wrapped in the documented envelope.
 */
export async function invokeOperation(
  input: InvokeOperationInput,
): Promise<ConnectorResultEnvelope> {
  const { connector, operationName, args, env } = input;
  const type = lookupConnectorType(connector.type);
  if (!type) {
    return buildFailureEnvelope({
      connector: connector.name,
      operation: operationName,
      code: "connector-not-found",
      message: `No registered connector type '${connector.type}' for connector '${connector.name}'.`,
    });
  }

  const operation = type.operations[operationName];
  if (!operation) {
    const known = Object.keys(type.operations).sort();
    return buildFailureEnvelope({
      connector: connector.name,
      operation: operationName,
      code: "unknown-operation",
      message: `Connector '${connector.name}' (type '${type.id}') has no operation '${operationName}'. Known operations: ${known.join(", ") || "(none)"}.`,
    });
  }

  let resolvedConfig: unknown;
  try {
    resolvedConfig = type.configSchema.parse(connector.config);
  } catch (err) {
    return buildFailureEnvelope({
      connector: connector.name,
      operation: operationName,
      code: "invalid-argument",
      message: `Connector '${connector.name}' has invalid per-type config for type '${type.id}'.`,
      details: { cause: zodIssueDetails(err) },
    });
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = operation.argsSchema.parse(args ?? {});
  } catch (err) {
    return buildFailureEnvelope({
      connector: connector.name,
      operation: operationName,
      code: "invalid-argument",
      message: `Invalid arguments for operation '${operationName}'.`,
      details: { cause: zodIssueDetails(err) },
    });
  }

  let auth: Awaited<ReturnType<typeof resolveAuth>>;
  try {
    auth = resolveAuth(connector.auth, env ?? process.env);
  } catch (err) {
    if (err instanceof AuthError) {
      return buildFailureEnvelope({
        connector: connector.name,
        operation: operationName,
        code: "missing-env-var",
        message: `Environment variable '${err.envVar}' is not set; required by connector '${connector.name}'.`,
        details: { envVar: err.envVar },
      });
    }
    throw err;
  }

  try {
    const result = await operation.handler(parsedArgs, {
      config: resolvedConfig,
      token: auth.type === "token" ? auth.value : undefined,
      auth,
    });
    return buildSuccessEnvelope({
      connector: connector.name,
      operation: operationName,
      data: result.data as Record<string, unknown>,
      dataSchemaVersion: operation.dataSchemaVersion,
    });
  } catch (err) {
    if (err instanceof ConnectorError) {
      return buildFailureEnvelope({
        connector: connector.name,
        operation: operationName,
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    process.stderr.write(
      `[maester] internal error in connector '${connector.name}'.${operationName}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    return buildFailureEnvelope({
      connector: connector.name,
      operation: operationName,
      code: "internal-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Compose the human/agent-facing description for a single connector operation.
 * Per Gap 48: if the entry carries a `description`, prepend it (trimmed) with
 * a single space separator; otherwise return the type's description alone.
 */
export function buildToolDescription(
  connector: Connector,
  operation: ConnectorOperation,
  resolvedConfig: unknown,
  type: ConnectorType,
): string {
  const typeDescription = type.describeTool(operation, resolvedConfig);
  const entryDescription = connector.description?.trim();
  return entryDescription ? `${entryDescription} ${typeDescription}` : typeDescription;
}

/**
 * Build the full `tools/list` descriptor set from a validated citadel config.
 * Used by both the MCP server (live) and `maester connector list` (debug).
 *
 * Configs with unknown connector types or per-type config validation failures
 * are surfaced as `Error` throws — the citadel schema's `.superRefine` should
 * have caught these at load time; reaching this function with an unknown type
 * means a registry mutation happened after load.
 */
export function listConnectorTools(config: CitadelConfig): ConnectorToolDescriptor[] {
  const descriptors: ConnectorToolDescriptor[] = [];
  const connectors = config.connectors ?? [];
  for (const connector of connectors) {
    const type = lookupConnectorType(connector.type);
    if (!type) {
      throw new Error(
        `Connector '${connector.name}' references unregistered type '${connector.type}'. This indicates registry mutation after config load.`,
      );
    }
    const resolvedConfig = type.configSchema.parse(connector.config);
    for (const operation of Object.values(type.operations)) {
      descriptors.push({
        name: toolName(connector.name, operation.name),
        description: buildToolDescription(connector, operation, resolvedConfig, type),
        inputSchema: argsSchemaToJsonSchema(operation.argsSchema),
      });
    }
  }
  return descriptors;
}

/**
 * Helper: find a connector and operation by their `(connectorName, operationName)`
 * pair without dispatching. Used by the MCP server's `tools/call` handler to
 * resolve the tool name back to a connector before invoking it.
 *
 * Returns `undefined` when either side is unknown — callers turn that into the
 * appropriate `connector-not-found` / `unknown-operation` envelope.
 */
export function findOperationByToolName(
  config: CitadelConfig,
  candidateToolName: string,
): { connector: Connector; operationName: string; type: ConnectorType } | undefined {
  const connectors = config.connectors ?? [];
  for (const connector of connectors) {
    const type = lookupConnectorType(connector.type);
    if (!type) continue;
    for (const operation of Object.values(type.operations)) {
      if (toolName(connector.name, operation.name) === candidateToolName) {
        return { connector, operationName: operation.name, type };
      }
    }
  }
  return undefined;
}

function zodIssueDetails(err: unknown): unknown {
  if (err instanceof z.ZodError) {
    return err.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
      code: issue.code,
    }));
  }
  return err instanceof Error ? err.message : String(err);
}
