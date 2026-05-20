import type { ConnectorErrorCode } from "./types.js";

/**
 * Error thrown by connector handlers to signal a known failure mode. The
 * dispatcher catches it and wraps it in the documented error envelope. Any
 * other exception is treated as `internal-error`.
 */
export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ConnectorErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.details = details;
  }
}
