import { type ConsolaInstance, createConsola } from "consola";
import type { Theming } from "./theme/index.js";

export type LogLevel = "silent" | "error" | "warn" | "info" | "verbose";

export type LoggerOptions = {
  theming: Theming;
  level?: LogLevel;
  json?: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
};

export type Logger = {
  level: LogLevel;
  json: boolean;
  success: (message: string, meta?: Record<string, unknown>) => void;
  warning: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  verbose: (message: string, meta?: Record<string, unknown>) => void;
  log: (message: string) => void;
  blank: () => void;
};

type Severity = "success" | "warning" | "error" | "info" | "verbose";

const SEVERITY_TO_GLYPH = {
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
  verbose: "info",
} as const;

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: -1,
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
};

function severityMeetsLevel(sev: Severity, level: LogLevel): boolean {
  if (level === "silent") return false;
  const need: LogLevel =
    sev === "error" ? "error" : sev === "warning" ? "warn" : sev === "verbose" ? "verbose" : "info";
  return LEVEL_RANK[need] <= LEVEL_RANK[level];
}

export function createLogger(opts: LoggerOptions): Logger {
  const level: LogLevel = opts.level ?? "info";
  const json = opts.json ?? false;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const { theming } = opts;

  const consola: ConsolaInstance = createConsola({
    level: level === "silent" ? -1 : LEVEL_RANK[level],
    formatOptions: { colors: false, date: false, compact: true },
  });
  void consola;

  function writeJson(sev: Severity, message: string, meta?: Record<string, unknown>): void {
    const payload = { level: sev, message, ...(meta ?? {}) };
    const stream = sev === "error" ? stderr : stdout;
    stream.write(`${JSON.stringify(payload)}\n`);
  }

  function writeHuman(sev: Severity, message: string): void {
    const role = SEVERITY_TO_GLYPH[sev];
    const g = theming.glyph(role);
    const paintedGlyph = g.token ? theming.painter.token(g.token, g.text) : g.text;
    const line = `${paintedGlyph}  ${message}`;
    const stream = sev === "error" ? stderr : stdout;
    stream.write(`${line}\n`);
  }

  function emit(sev: Severity, message: string, meta?: Record<string, unknown>): void {
    if (!severityMeetsLevel(sev, level)) return;
    if (json) {
      writeJson(sev, message, meta);
    } else {
      writeHuman(sev, message);
    }
  }

  return {
    level,
    json,
    success: (m, meta) => emit("success", m, meta),
    warning: (m, meta) => emit("warning", m, meta),
    error: (m, meta) => emit("error", m, meta),
    info: (m, meta) => emit("info", m, meta),
    verbose: (m, meta) => emit("verbose", m, meta),
    log: (message) => {
      if (level === "silent") return;
      if (json) {
        stdout.write(`${JSON.stringify({ level: "info", message })}\n`);
      } else {
        stdout.write(`${message}\n`);
      }
    },
    blank: () => {
      if (level === "silent" || json) return;
      stdout.write("\n");
    },
  };
}

export function redactUrl(value: string): string {
  return value.replace(/https?:\/\/([^:@/\s]+):([^@\s]+)@/g, (_, user) => `https://${user}:***@`);
}
