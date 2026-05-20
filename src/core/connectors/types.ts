import type { z } from "zod";
import type { ResolvedAuth } from "../auth/resolver.js";

export const ENVELOPE_SCHEMA_VERSION = 1 as const;

export type ConnectorErrorCode =
  | "missing-env-var"
  | "connector-not-found"
  | "unknown-operation"
  | "invalid-argument"
  | "auth-failed"
  | "remote-error"
  | "internal-error";

export const CONNECTOR_ERROR_CODES: readonly ConnectorErrorCode[] = [
  "missing-env-var",
  "connector-not-found",
  "unknown-operation",
  "invalid-argument",
  "auth-failed",
  "remote-error",
  "internal-error",
];

/**
 * Context passed to a connector operation handler. The dispatcher resolves the
 * per-type config and auth before invocation; the handler never reads env vars
 * or parses the raw connector entry.
 */
export type ConnectorContext<TConfig = unknown> = {
  /** Validated per-type config (already parsed by the type's configSchema). */
  readonly config: TConfig;
  /** Auth token value when the entry declared token auth; undefined otherwise. */
  readonly token: string | undefined;
  /** Resolved auth descriptor for handlers that need to know the mode. */
  readonly auth: ResolvedAuth;
};

/**
 * One operation exposed by a connector type. The same definition drives MCP
 * tool registration (via argsSchema → JSON Schema) and runtime dispatch.
 */
export type ConnectorOperation<TConfig = unknown, TArgs = unknown, TData = unknown> = {
  /** Operation name, kebab-case (e.g. `list-issues`). */
  readonly name: string;
  /** Validates the operation's args object. Used for both runtime + inputSchema. */
  readonly argsSchema: z.ZodType<TArgs>;
  /** Per-type data shape version embedded in success payloads. */
  readonly dataSchemaVersion: number;
  /** Pure handler — receives validated args + context; returns `{ data }` or throws. */
  readonly handler: (args: TArgs, ctx: ConnectorContext<TConfig>) => Promise<{ data: TData }>;
};

/**
 * A connector type registered with the framework. The registry is the only
 * place that imports per-type modules; everything else consults the registry.
 *
 * `operations` is intentionally an `any`-bounded record: each entry has its
 * own concrete TArgs/TData via `defineConnectorOperation`, and the framework
 * never touches the per-operation types directly — it routes through the
 * operation's `argsSchema` for validation and its `handler` for execution.
 */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous operation map; per-operation types live inside each operation's handler.
type AnyOperation<TConfig> = ConnectorOperation<TConfig, any, any>;

export type ConnectorType<TConfig = unknown> = {
  /** Stable identifier used as the `type` value in citadel.yaml. */
  readonly id: string;
  /** Short human-readable name (e.g. "GitLab Issues"). */
  readonly label: string;
  /** Validates one connector entry's per-type config object. */
  readonly configSchema: z.ZodType<TConfig>;
  /** Map of operation name → operation definition. */
  readonly operations: Readonly<Record<string, AnyOperation<TConfig>>>;
  /**
   * Returns the per-operation description rendered into `tools/list`. The
   * framework prepends the connector entry's `description` (when set) — types
   * do not do that composition themselves.
   */
  readonly describeTool: (operation: AnyOperation<TConfig>, resolvedConfig: TConfig) => string;
};

/**
 * The success envelope shared by MCP tool results and the fallback CLI.
 */
export type ConnectorSuccessEnvelope<TData = unknown> = {
  readonly schema: typeof ENVELOPE_SCHEMA_VERSION;
  readonly connector: string;
  readonly operation: string;
  readonly ok: true;
  readonly data: TData & { readonly dataSchema: number };
};

export type ConnectorErrorPayload = {
  readonly code: ConnectorErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

export type ConnectorFailureEnvelope = {
  readonly schema: typeof ENVELOPE_SCHEMA_VERSION;
  readonly connector: string;
  readonly operation: string;
  readonly ok: false;
  readonly error: ConnectorErrorPayload;
};

export type ConnectorResultEnvelope<TData = unknown> =
  | ConnectorSuccessEnvelope<TData>
  | ConnectorFailureEnvelope;

/**
 * Shape of a single MCP tool descriptor returned to clients during `tools/list`.
 * The framework owns this composition; types provide pieces.
 */
export type ConnectorToolDescriptor = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

/**
 * Helper for declaring an operation with TypeScript inference for args / data
 * types — `ConnectorOperation` defaults the generics to `unknown`, which
 * defeats inference at the call site. Use this in per-type modules instead of
 * the bare object literal.
 */
export function defineConnectorOperation<TConfig, TArgs, TData>(opts: {
  name: string;
  argsSchema: z.ZodType<TArgs>;
  dataSchemaVersion: number;
  handler: (args: TArgs, ctx: ConnectorContext<TConfig>) => Promise<{ data: TData }>;
}): ConnectorOperation<TConfig, TArgs, TData> {
  return opts;
}
