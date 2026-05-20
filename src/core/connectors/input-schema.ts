import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Convert a zod schema to a JSON Schema for use as an MCP tool's `inputSchema`
 * (Gap 38). Pinned to a minimal subset — no `$defs`, no `$ref`, no `$schema`
 * — so every MCP host parses it the same way.
 */
export function argsSchemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
  const {
    $schema: _omitSchema,
    definitions: _omitDefs,
    ...rest
  } = raw as Record<string, unknown> & {
    $schema?: unknown;
    definitions?: unknown;
  };
  return rest;
}
