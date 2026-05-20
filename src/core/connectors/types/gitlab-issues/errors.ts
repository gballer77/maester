import { ConnectorError } from "../../errors.js";

/**
 * Map a GitLab API HTTP response onto the framework's bounded error-code set.
 * Body is read by the caller and passed in as text so we can include a
 * truncated excerpt in `details.body` for `unexpected` responses without
 * burdening the caller with re-reading the response.
 */
export function mapGitLabHttpError(input: {
  status: number;
  body: string;
  headers: Headers;
  host: string;
  envVarName: string | undefined;
  context: { project: string; iid?: number };
}): ConnectorError {
  const { status, body, headers, host, envVarName, context } = input;

  if (status === 401 || status === 403) {
    return new ConnectorError(
      "auth-failed",
      envVarName
        ? `GitLab rejected the token from ${envVarName} (HTTP ${status}) on ${host}.`
        : `GitLab returned HTTP ${status} on ${host}.`,
      {
        status,
        ...(envVarName ? { envVar: envVarName } : {}),
        host,
      },
    );
  }

  if (status === 404) {
    const message =
      context.iid !== undefined
        ? `Issue ${context.iid} not found in project '${context.project}' on ${host}.`
        : `Project '${context.project}' not found on ${host}.`;
    return new ConnectorError("remote-error", message, {
      kind: "not-found",
      status,
      project: context.project,
      ...(context.iid !== undefined ? { iid: context.iid } : {}),
    });
  }

  if (status === 429) {
    const retryAfter = headers.get("retry-after");
    return new ConnectorError(
      "remote-error",
      `GitLab rate-limited the request (HTTP 429) on ${host}.${retryAfter ? ` Retry after ${retryAfter}s.` : ""}`,
      {
        kind: "rate-limited",
        status,
        ...(retryAfter ? { retryAfter } : {}),
      },
    );
  }

  if (status >= 500 && status <= 599) {
    return new ConnectorError("remote-error", `GitLab returned HTTP ${status} on ${host}.`, {
      kind: "transport",
      status,
    });
  }

  return new ConnectorError("remote-error", `Unexpected HTTP ${status} from GitLab on ${host}.`, {
    kind: "unexpected",
    status,
    body: truncateBody(body),
  });
}

/**
 * Map a thrown fetch/network exception onto a `transport` ConnectorError.
 * Used by the client when `fetch` itself rejects (DNS, TLS, refused, etc.).
 */
export function mapTransportError(err: unknown, host: string): ConnectorError {
  const message = err instanceof Error ? err.message : String(err);
  return new ConnectorError("remote-error", `Failed to reach GitLab at ${host}: ${message}`, {
    kind: "transport",
    cause: message,
  });
}

const BODY_EXCERPT_MAX = 1024;

function truncateBody(body: string): string {
  if (body.length <= BODY_EXCERPT_MAX) return body;
  return `${body.slice(0, BODY_EXCERPT_MAX)}…`;
}
