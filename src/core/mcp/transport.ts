import { type ConsolaInstance, consola } from "consola";

/**
 * MCP servers own stdout — every line is a JSON-RPC frame. Any unrelated
 * write to stdout corrupts the wire and kills the host's parser. Per Gap 41,
 * this module is the only place we boot the SDK from.
 *
 * Call `setupStdioForMcp()` once, before constructing any MCP Server, to:
 *
 *   - reconfigure the shared `consola` logger so its output goes to stderr,
 *   - silence prompt / progress layers that might otherwise write to stdout.
 *
 * The function is idempotent — second and later calls are no-ops.
 */
let installed = false;

export function setupStdioForMcp(): void {
  if (installed) return;
  installed = true;
  const logger = consola as ConsolaInstance & { setReporters?: (r: unknown[]) => void };
  if (typeof logger.setReporters === "function") {
    logger.setReporters([
      {
        log(logObj: { type?: string; args?: unknown[] }) {
          const text = formatConsolaLogObj(logObj);
          process.stderr.write(text);
        },
      },
    ]);
  }
}

function formatConsolaLogObj(logObj: { type?: string; args?: unknown[] }): string {
  const prefix = logObj.type ? `[${logObj.type}] ` : "";
  const body = (logObj.args ?? [])
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
  return `${prefix}${body}\n`;
}
