import { resolve } from "node:path";
import { z } from "zod";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
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

export const SourceSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(SLUG_RE, "name must be a kebab-case slug starting with a letter or digit"),
    url: z.string().refine(isValidGitUrl, "url must be https://, ssh://, or git@host:path"),
    ref: z.string().min(1).optional(),
    includes: z
      .array(
        z
          .string()
          .min(1)
          .refine(
            isSafeIncludesEntry,
            "includes entry must be a repo-relative path or glob; no leading '/' and no '..'",
          ),
      )
      .min(1, "includes must declare at least one entry when present")
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

export const DEFAULT_BASE_DIR = "citadel";

export function resolveBaseDir(config: { baseDir?: string }): string {
  return config.baseDir ?? DEFAULT_BASE_DIR;
}

type ParsedCitadel = {
  schemaVersion: 1;
  baseDir?: string;
  sources: z.infer<typeof SourceSchema>[];
};

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
  })
  .strict()
  .superRefine((data, ctx) => {
    applyCombinedInvariants(data as ParsedCitadel, ctx);
  });

export type AuthRef = z.infer<typeof AuthRefSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type CitadelConfig = z.infer<typeof CitadelConfigSchema>;
