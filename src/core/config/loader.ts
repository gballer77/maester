import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type YAMLError, parseDocument } from "yaml";
import type { z } from "zod";
import { type CitadelConfig, CitadelConfigSchema } from "../../schemas/citadel.js";
import { type MaesterConfig, MaesterConfigSchema } from "../../schemas/maester.js";
import { ConfigError } from "../errors.js";
import { citadelConfigPath, maesterConfigPath } from "./paths.js";

export async function loadCitadelConfig(repoRoot: string): Promise<CitadelConfig> {
  const path = citadelConfigPath(repoRoot);
  if (!existsSync(path)) {
    throw new ConfigError(
      "No citadel.yaml found at the repository root. Run `npx baller-maester init` to create one.",
      { filePath: path },
    );
  }
  const raw = await readFile(path, "utf8");
  return parseAndValidate(raw, CitadelConfigSchema, path);
}

export async function loadMaesterConfig(repoRoot: string): Promise<MaesterConfig> {
  const path = maesterConfigPath(repoRoot);
  if (!existsSync(path)) {
    throw new ConfigError(
      "No maester.yaml found at the repository root. Run `npx baller-maester publish` to create one.",
      { filePath: path },
    );
  }
  const raw = await readFile(path, "utf8");
  return parseAndValidate(raw, MaesterConfigSchema, path);
}

export async function loadMaesterConfigOptional(
  repoRoot: string,
): Promise<MaesterConfig | undefined> {
  const path = maesterConfigPath(repoRoot);
  if (!existsSync(path)) return undefined;
  const raw = await readFile(path, "utf8");
  return parseAndValidate(raw, MaesterConfigSchema, path);
}

export function parseAndValidate<T extends z.ZodTypeAny>(
  raw: string,
  schema: T,
  filePath: string,
): z.infer<T> {
  const data = parseYaml(raw, filePath);
  return runSchema(data, schema, filePath);
}

function parseYaml(raw: string, filePath: string): unknown {
  const doc = parseDocument(raw, { keepSourceTokens: false });
  const yamlErrors = doc.errors;
  if (yamlErrors.length > 0) {
    const first = yamlErrors[0] as YAMLError;
    const pos = positionFromError(first, raw);
    throw new ConfigError(`YAML parse error: ${first.message}`, {
      filePath,
      line: pos.line,
      column: pos.column,
      cause: first,
    });
  }
  return doc.toJS({ maxAliasCount: -1 });
}

function runSchema<T extends z.ZodTypeAny>(data: unknown, schema: T, filePath: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? ` at \`${issue.path.join(".")}\`` : "";
    throw new ConfigError(`${filePath}: ${issue?.message ?? "validation failed"}${where}`, {
      filePath,
      cause: result.error,
    });
  }
  return result.data;
}

function positionFromError(err: YAMLError, raw: string): { line: number; column: number } {
  const pos = (err as { pos?: [number, number] }).pos;
  if (!pos) return { line: 1, column: 1 };
  const offset = pos[0];
  let line = 1;
  let lastLineStart = 0;
  for (let i = 0; i < offset && i < raw.length; i++) {
    if (raw[i] === "\n") {
      line++;
      lastLineStart = i + 1;
    }
  }
  return { line, column: offset - lastLineStart + 1 };
}
