import { SLUG_RE } from "../../schemas/citadel.js";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateDocumentPath(value: string): ValidationResult {
  if (!value || value.length === 0) return { ok: false, reason: "Path cannot be empty." };
  if (/^\s+$/.test(value)) return { ok: false, reason: "Path cannot be whitespace only." };
  if (value.startsWith("/")) {
    return { ok: false, reason: "Path must be repo-relative (no leading '/')." };
  }
  if (value.split(/[\\/]+/).some((seg) => seg === "..")) {
    return { ok: false, reason: "Path cannot contain '..' segments." };
  }
  return { ok: true };
}

export function isGlobPath(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

export function validateCategory(value: string): ValidationResult {
  if (!value || value.length === 0) return { ok: true };
  if (!SLUG_RE.test(value)) {
    return { ok: false, reason: "Category must be a kebab-case slug." };
  }
  return { ok: true };
}

export function validateTags(value: string): ValidationResult {
  if (!value || value.length === 0) return { ok: true };
  const tags = value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const tag of tags) {
    if (!SLUG_RE.test(tag)) {
      return { ok: false, reason: `Tag '${tag}' must be a kebab-case slug.` };
    }
  }
  return { ok: true };
}

export function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
