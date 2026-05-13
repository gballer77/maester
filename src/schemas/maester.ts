import { z } from "zod";
import { StateSchema } from "../core/state/schema.js";
import { SLUG_RE } from "./citadel.js";

function isSafeRepoRelative(value: string): boolean {
  if (value.length === 0 || /^\s+$/.test(value)) return false;
  if (value.startsWith("/")) return false;
  if (value.split(/[\\/]+/).some((seg) => seg === "..")) return false;
  return true;
}

export const PublishedDocumentSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .refine(
        isSafeRepoRelative,
        "path must be a repo-relative file or glob; no leading '/' and no '..'",
      ),
    description: z.string().min(1).optional(),
    category: z.string().min(1).regex(SLUG_RE, "category must be a kebab-case slug").optional(),
    tags: z.array(z.string().min(1).regex(SLUG_RE, "tags must be slugs")).optional(),
    state: StateSchema.optional(),
  })
  .strict();

export const MaesterConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    documents: z
      .array(PublishedDocumentSchema)
      .min(1, "at least one published document must be declared")
      .superRefine((docs, ctx) => {
        const seen = new Map<string, number>();
        for (let i = 0; i < docs.length; i++) {
          const p = docs[i]?.path;
          if (!p) continue;
          const prior = seen.get(p);
          if (prior !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate path '${p}' (also at index ${prior})`,
              path: [i, "path"],
            });
          } else {
            seen.set(p, i);
          }
        }
      }),
  })
  .strict();

export type PublishedDocument = z.infer<typeof PublishedDocumentSchema>;
export type MaesterConfig = z.infer<typeof MaesterConfigSchema>;
