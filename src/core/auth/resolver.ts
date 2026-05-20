import type { AuthRef } from "../../schemas/citadel.js";
import { AuthError } from "../errors.js";

export type ResolvedAuth = { type: "delegated" } | { type: "token"; value: string; envVar: string };

export function resolveAuth(
  auth: AuthRef | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAuth {
  if (!auth || auth.type === "none") return { type: "delegated" };
  const value = env[auth.envVar];
  if (value === undefined || value.length === 0) {
    throw new AuthError(
      auth.envVar,
      `${auth.envVar} is not set. Define it in your shell, .env loader, or CI secret manager before syncing.`,
    );
  }
  return { type: "token", value, envVar: auth.envVar };
}
