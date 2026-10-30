import { resolve } from "node:path";
import { z } from "zod";
import { lookupConnectorType } from "../core/connectors/registry.js";
import {
  checkPathOverlap,
  expandSourcePathLexically,
  isRelativeDeclaration,
  malformedPlaceholder,
} from "../core/sources/local-path.js";
import { CategorySchema, SLUG_RE, StateSchema, TagsSchema } from "../core/state/schema.js";

export { SLUG_RE };
export const ENV_VAR_RE = /^[A-Z][A-Z0-9_]*$/;
const URL_FORMS = [/^https:\/\/\S+$/i, /^ssh:\/\/\S+$/i, /^git@[^\s:]+:\S+$/, /^file:\/\/\S+$/i];

function isValidGitUrl(url: string): boolean {
  if (/\s/.test(url)) return false;
  return URL_FORMS.some((re) => re.test(url));
}

function isSafeRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/")) return false;
  if (value.split(/[\\/]+/).some((seg) => seg === "..")) return false;
  return true;
}

function isSafeIncludesEntry(value: string): boolean {
  if (value.length === 0 || /^\s+$/.test(value)) return false;
  if (value.startsWith("/")) return false;
  if (value.split(/[\\/]+/).some((seg) => seg === "..")) return false;
  return true;
}

export const AuthRefNoneSchema = z
  .object({
    type: z.literal("none"),
  })
  .strict();

export const AuthRefTokenSchema = z
  .object({
    type: z.literal("token"),
    envVar: z
      .string()
      .min(1, "envVar is required for token auth")
      .regex(ENV_VAR_RE, "envVar must be uppercase letters, digits, and underscores"),
  })
  .strict();

export const AuthRefSchema = z.discriminatedUnion("type", [AuthRefNoneSchema, AuthRefTokenSchema]);

const IncludesPathSchema = z
  .string()
  .min(1)
  .refine(
    isSafeIncludesEntry,
    "includes entry must be a repo-relative path or glob; no leading '/' and no '..'",
  );

export const IncludeEntryObjectSchema = z
  .object({
    path: IncludesPathSchema,
    state: StateSchema.optional(),
    category: CategorySchema.optional(),
    tags: TagsSchema.optional(),
  })
  .strict();

export const IncludeEntrySchema = z.union([IncludesPathSchema, IncludeEntryObjectSchema]);

export type NormalizedIncludeEntry = {
  path: string;
  state?: z.infer<typeof StateSchema>;
  category?: string;
  tags?: string[];
};

export function normalizeIncludeEntry(
  entry: z.infer<typeof IncludeEntrySchema>,
): NormalizedIncludeEntry {
  if (typeof entry === "string") return { path: entry };
  const normalized: NormalizedIncludeEntry = { path: entry.path };
  if (entry.state !== undefined) normalized.state = entry.state;
  if (entry.category !== undefined) normalized.category = entry.category;
  if (entry.tags !== undefined) normalized.tags = entry.tags;
  return normalized;
}

export const SourceSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(SLUG_RE, "name must be a kebab-case slug starting with a letter or digit"),
    // Exactly one of url / path; the pairing rules live in the citadel
    // .superRefine so their errors can name the source.
    url: z
      .string()
      .refine(isValidGitUrl, "url must be https://, ssh://, or git@host:path")
      .optional(),
    path: z.string().min(1, "path must not be empty").optional(),
    mode: z.enum(["link", "copy"]).optional(),
    ref: z.string().min(1).optional(),
    includes: z
      .array(IncludeEntrySchema)
      .min(1, "includes must declare at least one entry when present")
      .optional(),
    // Applied only in whole-repository mode; ignored (with a sync warning)
    // when the source is includes-driven or manifest-driven.
    excludes: z
      .array(IncludesPathSchema)
      .min(1, "excludes must declare at least one entry when present")
      .optional(),
    auth: AuthRefSchema.optional(),
    destination: z
      .string()
      .min(1)
      .refine(isSafeRelativePath, "destination must be a repo-relative path with no '..' segments")
      .optional(),
    description: z.string().min(1).optional(),
    tags: z.array(z.string().min(1).regex(SLUG_RE, "tags must be slugs")).optional(),
  })
  .strict();

/**
 * Per-connector entry in `CitadelConfig.connectors`. Per-type `config` payload
 * is validated by the registered type's `configSchema` in `.superRefine` below.
 */
export const ConnectorBaseSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(SLUG_RE, "name must be a kebab-case slug starting with a letter or digit"),
    type: z.string().min(1),
    auth: AuthRefSchema.optional(),
    description: z.string().min(1).optional(),
    config: z.unknown().optional(),
  })
  .strict();

export const DEFAULT_BASE_DIR = "citadel";

export function resolveBaseDir(config: { baseDir?: string }): string {
  return config.baseDir ?? DEFAULT_BASE_DIR;
}

type ParsedCitadel = {
  schemaVersion: 1;
  baseDir?: string;
  sources: z.infer<typeof SourceSchema>[];
  connectors?: z.infer<typeof ConnectorBaseSchema>[];
};

const VALIDATION_ROOT = "/_citadel_root_";

/** Prefix of the built-in linked-document MCP tools (`citadel__…`). */
export const RESERVED_CONNECTOR_NAME = "citadel";

/** Pairing rules for git (`url`) vs path (`path`) sources (Local Maesters P0). */
function checkSourceKinds(
  sources: readonly z.infer<typeof SourceSchema>[],
  baseDir: string,
  ctx: z.RefinementCtx,
): void {
  const destinations = sources.map((s) => {
    const display = s.destination ?? `${baseDir}/${s.name}`;
    return { name: s.name, path: resolve(VALIDATION_ROOT, display), display };
  });
  for (let i = 0; i < sources.length; i++) {
    const entry = sources[i];
    if (!entry) continue;
    const issue = (message: string, field: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["sources", i, field] });

    if (entry.url !== undefined && entry.path !== undefined) {
      issue(`source '${entry.name}' declares both url and path — keep exactly one`, "path");
      continue;
    }
    if (entry.url === undefined && entry.path === undefined) {
      issue(
        `source '${entry.name}' needs a url (git repository) or a path (local directory)`,
        "url",
      );
      continue;
    }
    if (entry.url !== undefined) {
      if (entry.mode !== undefined) {
        issue("`mode` applies only to path (local directory) sources", "mode");
      }
      continue;
    }

    const path = entry.path ?? "";
    if (entry.ref !== undefined) issue("`ref` applies only to git (`url`) sources", "ref");
    if (entry.auth !== undefined) issue("`auth` applies only to git (`url`) sources", "auth");
    const bad = malformedPlaceholder(path);
    if (bad) {
      issue(
        `source '${entry.name}' path has a malformed placeholder ${bad} — use \${NAME} with an uppercase env-var name`,
        "path",
      );
      continue;
    }
    // Lexical overlap check for repo-relative paths only; absolute, ~ and
    // ${VAR} paths are checked at run time after realpath().
    if (isRelativeDeclaration(path)) {
      const sourcePath = expandSourcePathLexically(entry.name, path, {
        repoRoot: VALIDATION_ROOT,
        env: {},
      });
      const overlap = checkPathOverlap(entry.name, path, sourcePath, {
        baseDir: resolve(VALIDATION_ROOT, baseDir),
        baseDirDisplay: baseDir,
        destinations,
      });
      if (overlap) issue(overlap, "path");
    }
  }
}

function applyCombinedInvariants(data: ParsedCitadel, ctx: z.RefinementCtx): void {
  if (data.sources.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "citadel must declare at least one source",
      path: ["sources"],
    });
    return;
  }

  const baseDir = data.baseDir ?? DEFAULT_BASE_DIR;
  checkSourceKinds(data.sources, baseDir, ctx);
  const namesSeen = new Map<string, number>();
  const destsSeen = new Map<string, { index: number; name: string }>();

  for (let i = 0; i < data.sources.length; i++) {
    const entry = data.sources[i];
    if (!entry?.name) continue;
    const priorIndex = namesSeen.get(entry.name);
    if (priorIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate name '${entry.name}' — also used by sources[${priorIndex}]`,
        path: ["sources", i, "name"],
      });
    } else {
      namesSeen.set(entry.name, i);
    }

    const resolved = entry.destination
      ? resolve("/_citadel_root_", entry.destination)
      : resolve("/_citadel_root_", baseDir, entry.name);
    const prior = destsSeen.get(resolved);
    if (prior !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `destination collision: sources '${entry.name}' and '${prior.name}' (sources[${prior.index}]) both resolve to the same path`,
        path: ["sources", i, "destination"],
      });
    } else {
      destsSeen.set(resolved, { index: i, name: entry.name });
    }
  }

  const connectorNames = new Map<string, number>();
  const connectors = data.connectors ?? [];
  for (let i = 0; i < connectors.length; i++) {
    const entry = connectors[i];
    if (!entry?.name) continue;

    if (entry.name === RESERVED_CONNECTOR_NAME) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `connector name '${RESERVED_CONNECTOR_NAME}' is reserved for maester's built-in citadel tools`,
        path: ["connectors", i, "name"],
      });
    }

    const priorIndex = connectorNames.get(entry.name);
    if (priorIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate connector name '${entry.name}' — also used by connectors[${priorIndex}]`,
        path: ["connectors", i, "name"],
      });
    } else {
      connectorNames.set(entry.name, i);
    }

    const type = lookupConnectorType(entry.type);
    if (!type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown connector type '${entry.type}' for connector '${entry.name}'`,
        path: ["connectors", i, "type"],
      });
      continue;
    }

    const configResult = type.configSchema.safeParse(entry.config ?? {});
    if (!configResult.success) {
      for (const issue of configResult.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["connectors", i, "config", ...issue.path],
        });
      }
    }
  }
}

export const CitadelConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    baseDir: z
      .string()
      .min(1)
      .refine(isSafeRelativePath, "baseDir must be a repo-relative path with no '..' segments")
      .optional(),
    sources: z.array(SourceSchema).optional().default([]),
    connectors: z.array(ConnectorBaseSchema).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    applyCombinedInvariants(data as ParsedCitadel, ctx);
  });

export type AuthRef = z.infer<typeof AuthRefSchema>;
export type IncludeEntry = z.infer<typeof IncludeEntrySchema>;
export type Source = z.infer<typeof SourceSchema>;
export type GitSource = Source & { url: string; path?: undefined };
export type PathSource = Source & { path: string; url?: undefined };

export function isPathSource(source: Source): source is PathSource {
  return typeof source.path === "string";
}

export function isGitSource(source: Source): source is GitSource {
  return typeof source.url === "string";
}
export type Connector = z.infer<typeof ConnectorBaseSchema>;
export type CitadelConfig = z.infer<typeof CitadelConfigSchema>;
