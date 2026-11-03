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
    // Git submodules the filter set reaches are fetched by default; `false`
    // opts out (path sources then skip submodule content).
    submodules: z.boolean().optional(),
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

/** MCP server names become tool prefixes and host entry keys (Gap 57, Gap 59). */
export const MCP_SERVER_NAME_RE = /^[a-z][a-z0-9-]*$/;
export const MCP_SERVER_NAME_MAX = 32;
/** Names that would collide with the `maester` host entry or the built-in `citadel__` tools. */
export const RESERVED_TOOL_PREFIXES = ["maester", "citadel"] as const;

// Static messages: a pasted secret in one of these fields must never be echoed back.
const EnvVarNameSchema = z
  .string()
  .regex(
    ENV_VAR_RE,
    "must be an env-var NAME (uppercase letters, digits, underscores), not a value",
  );

const McpServerNameSchema = z
  .string()
  .min(1)
  .max(MCP_SERVER_NAME_MAX, `name must be at most ${MCP_SERVER_NAME_MAX} characters`)
  .regex(
    MCP_SERVER_NAME_RE,
    "name must start with a lowercase letter and contain only lowercase letters, digits, and '-'",
  );

const McpServerCommonShape = {
  name: McpServerNameSchema,
  description: z.string().min(1).optional(),
  register: z.enum(["proxy", "direct"]).optional(),
  tools: z.array(z.string().min(1)).optional(),
};

export const LocalMcpServerSchema = z
  .object({
    ...McpServerCommonShape,
    kind: z.literal("local"),
    command: z
      .string()
      .min(1, "command is required")
      .refine((v) => v.trim() === v, "command must not have leading or trailing whitespace"),
    args: z.array(z.string()).optional(),
    envVars: z.array(EnvVarNameSchema).optional(),
  })
  .strict();

function isAllowedMcpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export const RemoteMcpServerSchema = z
  .object({
    ...McpServerCommonShape,
    kind: z.literal("remote"),
    url: z.string().refine(isAllowedMcpUrl, "url must be https:// (http:// only for localhost)"),
    auth: z
      .object({
        envVar: EnvVarNameSchema,
        header: z
          .string()
          .regex(/^[A-Za-z0-9-]+$/, "header must be an HTTP header name")
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const McpServerSchema = z.discriminatedUnion("kind", [
  LocalMcpServerSchema,
  RemoteMcpServerSchema,
]);

export const DEFAULT_BASE_DIR = "citadel";

export function resolveBaseDir(config: { baseDir?: string }): string {
  return config.baseDir ?? DEFAULT_BASE_DIR;
}

type ParsedCitadel = {
  schemaVersion: 1;
  baseDir?: string;
  sources: z.infer<typeof SourceSchema>[];
  connectors?: z.infer<typeof ConnectorBaseSchema>[];
  mcpServers?: z.infer<typeof McpServerSchema>[];
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
    } else if (entry.name === "maester") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "connector name 'maester' is reserved for the maester MCP host entry",
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

  checkMcpServerNames(data, connectorNames, ctx);
}

/** Gap 57: one namespace across connectors + mcpServers; `maester` / `citadel` reserved. */
function checkMcpServerNames(
  data: ParsedCitadel,
  connectorNames: ReadonlyMap<string, number>,
  ctx: z.RefinementCtx,
): void {
  const servers = data.mcpServers ?? [];
  const seen = new Map<string, number>();
  for (let i = 0; i < servers.length; i++) {
    const name = servers[i]?.name;
    if (!name) continue;
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["mcpServers", i, "name"] });
    if ((RESERVED_TOOL_PREFIXES as readonly string[]).includes(name)) {
      issue(`MCP server name '${name}' is reserved`);
    }
    const connectorIndex = connectorNames.get(name);
    if (connectorIndex !== undefined) {
      issue(
        `duplicate name '${name}' — mcpServers[${i}] and connectors[${connectorIndex}] share one tool namespace`,
      );
    }
    const prior = seen.get(name);
    if (prior !== undefined) {
      issue(`duplicate MCP server name '${name}' — also used by mcpServers[${prior}]`);
    } else {
      seen.set(name, i);
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
    mcpServers: z.array(McpServerSchema).optional(),
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
export type McpServer = z.infer<typeof McpServerSchema>;
export type LocalMcpServer = z.infer<typeof LocalMcpServerSchema>;
export type RemoteMcpServer = z.infer<typeof RemoteMcpServerSchema>;

export function isDirectMcpServer(server: McpServer): boolean {
  return server.register === "direct";
}
