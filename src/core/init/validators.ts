import { ENV_VAR_RE, SLUG_RE } from "../../schemas/citadel.js";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateSourceName(value: string): ValidationResult {
  if (!value || value.length === 0) return { ok: false, reason: "Name cannot be empty." };
  if (!SLUG_RE.test(value)) {
    return {
      ok: false,
      reason: "Name must be a kebab-case slug (lowercase letters, digits, and hyphens).",
    };
  }
  return { ok: true };
}

export function validateGitUrl(value: string): ValidationResult {
  if (!value || value.length === 0) return { ok: false, reason: "URL cannot be empty." };
  if (/\s/.test(value)) return { ok: false, reason: "URL cannot contain whitespace." };
  if (value.startsWith("https://") || value.startsWith("ssh://") || value.startsWith("file://")) {
    return { ok: true };
  }
  if (/^git@[^\s:]+:\S+$/.test(value)) return { ok: true };
  return {
    ok: false,
    reason: "URL must start with https://, ssh://, file://, or use the git@host:path form.",
  };
}

export type EnvVarValidation = { ok: true; warning?: string } | { ok: false; reason: string };

export function validateEnvVarName(value: string): EnvVarValidation {
  if (!value || value.length === 0) {
    return { ok: false, reason: "Environment variable name cannot be empty." };
  }
  if (/\s/.test(value)) return { ok: false, reason: "Whitespace is not allowed." };
  if (!ENV_VAR_RE.test(value)) {
    return {
      ok: false,
      reason: "Environment variable name must be UPPER_SNAKE_CASE (e.g. MAESTER_DOCS_TOKEN).",
    };
  }
  if (value.length >= 32 && !value.includes("_")) {
    return {
      ok: true,
      warning:
        "That looks unusually long and has no underscores — make sure you entered the NAME of the env var, not its value.",
    };
  }
  return { ok: true };
}

export function validateDestination(value: string): ValidationResult {
  if (!value || value.length === 0) return { ok: true };
  if (value.startsWith("/"))
    return { ok: false, reason: "Destination must be repo-relative (no leading '/')." };
  if (value.split(/[\\/]+/).some((seg) => seg === "..")) {
    return { ok: false, reason: "Destination cannot contain '..' segments." };
  }
  return { ok: true };
}

export function validateBaseDir(value: string): ValidationResult {
  if (!value || value.length === 0) return { ok: true };
  if (value.startsWith("/"))
    return { ok: false, reason: "Base directory must be repo-relative (no leading '/')." };
  if (value.split(/[\\/]+/).some((seg) => seg === "..")) {
    return { ok: false, reason: "Base directory cannot contain '..' segments." };
  }
  return { ok: true };
}

export function validateIncludesEntry(value: string): ValidationResult {
  if (!value || value.length === 0) return { ok: false, reason: "Includes entry cannot be empty." };
  if (/^\s+$/.test(value)) return { ok: false, reason: "Includes entry cannot be whitespace." };
  if (value.startsWith("/")) {
    return { ok: false, reason: "Includes entry must be repo-relative (no leading '/')." };
  }
  if (value.split(/[\\/]+/).some((seg) => seg === "..")) {
    return { ok: false, reason: "Includes entry cannot contain '..' segments." };
  }
  return { ok: true };
}

export function validateTag(value: string): ValidationResult {
  if (!value || value.length === 0) return { ok: false, reason: "Tag cannot be empty." };
  if (!SLUG_RE.test(value)) {
    return { ok: false, reason: "Tag must be a kebab-case slug." };
  }
  return { ok: true };
}
