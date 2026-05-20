import { z } from "zod";

const DEFAULT_HOST = "https://gitlab.com";

function isHttpsUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (!/^https:\/\/[^/]+/i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trim a trailing slash so the request builder can concatenate
 * `${host}/api/v4/...` without producing `//`.
 */
function normalizeHost(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export const GITLAB_DEFAULT_HOST = DEFAULT_HOST;

export const GitLabIssuesConfigSchema = z
  .object({
    host: z
      .string()
      .refine(isHttpsUrl, "host must be an HTTPS URL (e.g. https://gitlab.com)")
      .transform(normalizeHost)
      .optional()
      .default(DEFAULT_HOST),
    project: z
      .string()
      .min(1, "project is required")
      .refine((v) => !/\s/.test(v), "project must not contain whitespace"),
    apiVersion: z.literal(4).optional().default(4),
  })
  .strict();

export type GitLabIssuesConfig = z.infer<typeof GitLabIssuesConfigSchema>;
