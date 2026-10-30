/**
 * The bounded failure vocabulary shared by `maester mcp` logs and
 * `maester mcp-server check` (architecture §6.17, Gap 61).
 */
export const UPSTREAM_FAILURE_REASONS = [
  "missing-env-var",
  "command-not-found",
  "connection-refused",
  "auth-failed",
  "timeout",
  "protocol-error",
  "exited",
] as const;

export type UpstreamFailureReason = (typeof UPSTREAM_FAILURE_REASONS)[number];

export type UpstreamFailure = {
  reason: UpstreamFailureReason;
  /** Human detail. Never contains env-var values. */
  detail?: string;
};

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** Map an error thrown while connecting to an upstream onto a reason code. */
export function classifyUpstreamError(err: unknown, timedOut: boolean): UpstreamFailure {
  if (timedOut) return { reason: "timeout" };
  const code = errorCode(err);
  if (code === "ENOENT") return { reason: "command-not-found", detail: messageOf(err) };
  if (code !== undefined && CONNECTION_CODES.has(code)) {
    return { reason: "connection-refused", detail: code };
  }
  const status = httpStatus(err);
  if (status === 401 || status === 403 || errorName(err) === "UnauthorizedError") {
    return status ? { reason: "auth-failed", detail: `HTTP ${status}` } : { reason: "auth-failed" };
  }
  // fetch() network failures without a socket code (blocked port, aborted TLS).
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    return {
      reason: "connection-refused",
      detail: messageOf((err as { cause?: unknown }).cause ?? err),
    };
  }
  if (/connection closed/i.test(messageOf(err))) return { reason: "exited" };
  return { reason: "protocol-error", detail: messageOf(err) };
}

/** `missing-env-var TRACKER_TOKEN`, `command-not-found (spawn foo ENOENT)`. */
export function formatFailure(failure: UpstreamFailure): string {
  if (!failure.detail) return failure.reason;
  return failure.reason === "missing-env-var"
    ? `${failure.reason} ${failure.detail}`
    : `${failure.reason} (${failure.detail})`;
}

function errorCode(err: unknown): string | undefined {
  // fetch() wraps socket errors: TypeError("fetch failed", { cause: { code } }).
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

function httpStatus(err: unknown): number | undefined {
  if (errorName(err) !== "StreamableHTTPError") {
    const match = /HTTP (\d{3})/.exec(messageOf(err));
    return match ? Number(match[1]) : undefined;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

function errorName(err: unknown): string | undefined {
  return err instanceof Error ? err.constructor.name : undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
