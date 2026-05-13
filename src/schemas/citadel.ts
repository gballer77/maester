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

export const MaesterSourceSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(SLUG_RE, "name must be a kebab-case slug starting with a letter or digit"),
    url: z.string().refine(isValidGitUrl, "url must be https://, ssh://, or git@host:path"),
    ref: z.string().min(1).optional(),
    auth: AuthRefSchema.optional(),
    destination: z
      .string()
      .min(1)
      .refine(isSafeRelativePath, "destination must be a repo-relative path with no '..' segments")
      .optional(),
  })
  .strict();

export const RavenSourceSchema = z
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
      .min(1, "ravens must declare at least one includes entry"),
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

type ParsedCitadelV2 = {
  schemaVersion: 2;
  maesters: z.infer<typeof MaesterSourceSchema>[];
  ravens: z.infer<typeof RavenSourceSchema>[];
};

function applyCombinedInvariants(
  data: ParsedCitadelV2,
  ctx: z.RefinementCtx,
  baseFieldOverride?: { maestersField: string },
): void {
  const maestersField = baseFieldOverride?.maestersField ?? "maesters";
  const total = data.maesters.length + data.ravens.length;
  if (total === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "citadel must declare at least one maester or raven",
      path: [maestersField],
    });
    return;
  }

  const namesSeen = new Map<string, { kind: "maester" | "raven"; field: string; index: number }>();
  const destsSeen = new Map<
    string,
    { kind: "maester" | "raven"; field: string; index: number; name: string }
  >();

  function registerName(
    name: string | undefined,
    kind: "maester" | "raven",
    field: string,
    index: number,
  ): void {
    if (!name) return;
    const prior = namesSeen.get(name);
    if (prior !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate name '${name}' — also used by ${prior.kind} at ${prior.field}[${prior.index}]`,
        path: [field, index, "name"],
      });
    } else {
      namesSeen.set(name, { kind, field, index });
    }
  }

  function registerDestination(
    name: string | undefined,
    destination: string | undefined,
    kind: "maester" | "raven",
    field: string,
    index: number,
  ): void {
    if (!name) return;
    const resolved = destination
      ? resolve("/_citadel_root_", destination)
      : resolve("/_citadel_root_", "citadel", name);
    const prior = destsSeen.get(resolved);
    if (prior !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `destination collision: ${kind} '${name}' and ${prior.kind} '${prior.name}' (${prior.field}[${prior.index}]) both resolve to the same path`,
        path: [field, index, "destination"],
      });
    } else {
      destsSeen.set(resolved, { kind, field, index, name });
    }
  }

  for (let i = 0; i < data.maesters.length; i++) {
    const entry = data.maesters[i];
    registerName(entry?.name, "maester", maestersField, i);
    registerDestination(entry?.name, entry?.destination, "maester", maestersField, i);
  }
  for (let i = 0; i < data.ravens.length; i++) {
    const entry = data.ravens[i];
    registerName(entry?.name, "raven", "ravens", i);
    registerDestination(entry?.name, entry?.destination, "raven", "ravens", i);
  }
}

export const CitadelConfigSchema = z
  .object({
    schemaVersion: z.literal(2),
    maesters: z.array(MaesterSourceSchema).optional().default([]),
    ravens: z.array(RavenSourceSchema).optional().default([]),
  })
  .strict()
  .superRefine((data, ctx) => {
    applyCombinedInvariants(data as ParsedCitadelV2, ctx);
  });

export const CitadelConfigV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    sources: z.array(MaesterSourceSchema),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Run the same invariants against the v1 shape so legacy configs are still validated.
    applyCombinedInvariants(
      {
        schemaVersion: 2,
        maesters: data.sources,
        ravens: [],
      },
      ctx,
      { maestersField: "sources" },
    );
  });

export function migrateCitadelV1ToV2(
  v1: z.infer<typeof CitadelConfigV1Schema>,
): z.infer<typeof CitadelConfigSchema> {
  return {
    schemaVersion: 2,
    maesters: v1.sources,
    ravens: [],
  };
}

export type AuthRef = z.infer<typeof AuthRefSchema>;
export type MaesterSource = z.infer<typeof MaesterSourceSchema>;
export type RavenSource = z.infer<typeof RavenSourceSchema>;
export type CitadelConfig = z.infer<typeof CitadelConfigSchema>;
export type CitadelConfigV1 = z.infer<typeof CitadelConfigV1Schema>;
