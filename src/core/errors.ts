export class MaesterError extends Error {
  readonly code: string;
  override readonly cause?: unknown;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MaesterError";
    this.code = code;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class ConfigError extends MaesterError {
  readonly filePath: string | undefined;
  readonly line?: number;
  readonly column?: number;
  constructor(
    message: string,
    detail: { filePath?: string; line?: number; column?: number; cause?: unknown } = {},
  ) {
    super("CONFIG_ERROR", message, detail.cause !== undefined ? { cause: detail.cause } : {});
    this.name = "ConfigError";
    this.filePath = detail.filePath;
    if (detail.line !== undefined) this.line = detail.line;
    if (detail.column !== undefined) this.column = detail.column;
  }
}

export class AuthError extends MaesterError {
  readonly envVar: string;
  constructor(envVar: string, message?: string) {
    super("AUTH_ERROR", message ?? `Environment variable ${envVar} is not set.`);
    this.name = "AuthError";
    this.envVar = envVar;
  }
}

export class RefNotFoundError extends MaesterError {
  readonly ref: string;
  readonly url: string;
  constructor(ref: string, url: string, cause?: unknown) {
    super(
      "REF_NOT_FOUND",
      `ref \`${ref}\` not found on \`${url}\``,
      cause !== undefined ? { cause } : {},
    );
    this.name = "RefNotFoundError";
    this.ref = ref;
    this.url = url;
  }
}

export class DestinationBlockedError extends MaesterError {
  readonly destination: string;
  constructor(destination: string, message: string) {
    super("DESTINATION_BLOCKED", message);
    this.name = "DestinationBlockedError";
    this.destination = destination;
  }
}
