const VALID_TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Build the MCP tool name for a (connector, operation) pair per architecture
 * Gap 37: lowercase both halves, replace every '-' with '_', join with '__',
 * validate against `^[a-z][a-z0-9_]*$`.
 *
 * A failed validation is a programmer error (the connector or operation name
 * would have been rejected by the schema before reaching this point); the
 * thrown error halts MCP server startup with a clear stderr message.
 */
export function toolName(connectorName: string, operationName: string): string {
  const left = normalize(connectorName);
  const right = normalize(operationName);
  const result = `${left}__${right}`;
  if (!VALID_TOOL_NAME_RE.test(result)) {
    throw new Error(
      `Invalid MCP tool name '${result}' (from connector '${connectorName}', operation '${operationName}'). Names must match /^[a-z][a-z0-9_]*$/ after normalization.`,
    );
  }
  return result;
}

function normalize(part: string): string {
  return part.toLowerCase().replace(/-/g, "_");
}
