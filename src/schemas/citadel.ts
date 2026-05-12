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

export const CitadelConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    sources: z
      .array(MaesterSourceSchema)
      .min(1, "at least one source must be declared")
      .superRefine((sources, ctx) => {
        const seen = new Map<string, number>();
        for (let i = 0; i < sources.length; i++) {
          const name = sources[i]?.name;
          if (!name) continue;
          const prior = seen.get(name);
          if (prior !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate source name '${name}' (also at index ${prior})`,
              path: [i, "name"],
            });
          } else {
            seen.set(name, i);
          }
        }
      }),
  })
  .strict();

export type AuthRef = z.infer<typeof AuthRefSchema>;
export type MaesterSource = z.infer<typeof MaesterSourceSchema>;
export type CitadelConfig = z.infer<typeof CitadelConfigSchema>;
