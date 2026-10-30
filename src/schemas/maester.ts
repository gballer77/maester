import { z } from "zod";
import { CategorySchema, StateSchema, TagsSchema } from "../core/state/schema.js";

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
    category: CategorySchema.optional(),
    tags: TagsSchema.optional(),
    state: StateSchema.optional(),
  })
  .strict();

export const MaesterConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    // An empty (or omitted) list means "publish the whole repository" —
    // consuming citadels resolve such a source to whole-repository mode.
    documents: z
      .array(PublishedDocumentSchema)
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
      })
      .optional()
      .default([]),
  })
  .strict();

export type PublishedDocument = z.infer<typeof PublishedDocumentSchema>;
export type MaesterConfig = z.infer<typeof MaesterConfigSchema>;
