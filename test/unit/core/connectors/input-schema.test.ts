import { describe, expect, it } from "vitest";
import { z } from "zod";
import { argsSchemaToJsonSchema } from "../../../../src/core/connectors/input-schema.js";

describe("argsSchemaToJsonSchema", () => {
  it("emits a minimal JSON Schema with no $schema, $defs, $ref, or definitions keys", () => {
    const schema = z.object({
      iid: z.number().int().positive(),
      state: z.enum(["opened", "closed", "all"]).default("opened"),
    });
    const json = argsSchemaToJsonSchema(schema);
    expect(json.type).toBe("object");
    expect("$schema" in json).toBe(false);
    expect("$defs" in json).toBe(false);
    expect("$ref" in json).toBe(false);
    expect("definitions" in json).toBe(false);
  });

  it("declares properties with their types", () => {
    const schema = z.object({
      labels: z.string().optional(),
      page: z.number().int().min(1).default(1),
    });
    const json = argsSchemaToJsonSchema(schema) as {
      type: string;
      properties: Record<string, { type: string }>;
    };
    expect(json.type).toBe("object");
    expect(json.properties.labels?.type).toBe("string");
    expect(json.properties.page?.type).toBe("integer");
  });

  it("marks fields as required when zod has no .optional()/.default()", () => {
    const schema = z.object({
      iid: z.number(),
      title: z.string().optional(),
    });
    const json = argsSchemaToJsonSchema(schema) as { required?: string[] };
    expect(json.required).toContain("iid");
    expect(json.required ?? []).not.toContain("title");
  });
});
