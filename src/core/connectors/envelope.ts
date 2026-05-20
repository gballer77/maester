import {
  type ConnectorErrorCode,
  type ConnectorFailureEnvelope,
  type ConnectorSuccessEnvelope,
  ENVELOPE_SCHEMA_VERSION,
} from "./types.js";

export type SuccessInput<TData> = {
  connector: string;
  operation: string;
  data: TData;
  dataSchemaVersion: number;
};

export type FailureInput = {
  connector: string;
  operation: string;
  code: ConnectorErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

/**
 * Single chokepoint for building success envelopes. Both the MCP server and
 * the fallback CLI must use this — assembling the envelope by hand would
 * drift the two surfaces apart.
 */
export function buildSuccessEnvelope<TData extends Record<string, unknown>>(
  input: SuccessInput<TData>,
): ConnectorSuccessEnvelope<TData> {
  return {
    schema: ENVELOPE_SCHEMA_VERSION,
    connector: input.connector,
    operation: input.operation,
    ok: true,
    data: { ...input.data, dataSchema: input.dataSchemaVersion },
  } as ConnectorSuccessEnvelope<TData>;
}

/**
 * Single chokepoint for building failure envelopes.
 */
export function buildFailureEnvelope(input: FailureInput): ConnectorFailureEnvelope {
  return {
    schema: ENVELOPE_SCHEMA_VERSION,
    connector: input.connector,
    operation: input.operation,
    ok: false,
    error: {
      code: input.code,
      message: input.message,
      ...(input.details ? { details: input.details } : {}),
    },
  };
}
