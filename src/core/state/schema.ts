import { z } from "zod";

export const STATE_VALUES = ["draft", "canon"] as const;
export const StateSchema = z.enum(STATE_VALUES);
export type State = z.infer<typeof StateSchema>;

export const DEFAULT_STATE: State = "draft";

export type ParseStateResult =
  | { kind: "valid"; value: State }
  | { kind: "invalid"; raw: string }
  | { kind: "absent" };

export type RuleEntry = {
  pattern: string;
  state?: State;
};

export function parseState(value: unknown): ParseStateResult {
  if (value === undefined || value === null) return { kind: "absent" };
  const raw = typeof value === "string" ? value : String(value);
  if (raw.length === 0) return { kind: "absent" };
  const result = StateSchema.safeParse(raw);
  if (result.success) return { kind: "valid", value: result.data };
  return { kind: "invalid", raw };
}
