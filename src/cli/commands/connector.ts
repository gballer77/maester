import type { Command } from "commander";
import { loadCitadelConfig } from "../../core/config/loader.js";
import { invokeOperation } from "../../core/connectors/dispatch.js";
import { hasConnectorType, listConnectorTypes } from "../../core/connectors/registry.js";
import { toolName } from "../../core/connectors/tool-name.js";
import { ConfigError, MaesterError } from "../../core/errors.js";
import {
  ConnectorNotFoundError,
  addConnectorToCitadel,
  listConnectorsFromCitadel,
  removeConnectorFromCitadel,
} from "../../core/init/connector-writer.js";
import { refreshMcpRegistrations } from "../../core/mcp/registrations/index.js";
import { type Connector, ENV_VAR_RE, SLUG_RE } from "../../schemas/citadel.js";
import { PromptCancelledError } from "../../ui/prompts.js";
import type { CliContext } from "../context.js";

const EXIT_OK = 0;
const EXIT_FALLBACK_FAILURE = 1;
const EXIT_INVOCATION_ERROR = 2;

export function registerConnector(program: Command, getContext: () => CliContext): void {
  const group = program
    .command("connector")
    .description(
      "Manage citadel connectors (traveling maesters) and dispatch operations for non-MCP agents.",
    );

  group
    .command("list")
    .description("Print the configured connectors and the tool names the MCP server exposes.")
    .action(async () => {
      process.exitCode = await runList(getContext());
    });

  group
    .command("add")
    .description(
      "Register a new connector with this citadel. Interactive when no flags are passed.",
    )
    .option("--type <type>", "Connector type identifier (e.g. gitlab-issues).")
    .option("--name <name>", "Unique connector name (kebab-case slug).")
    .option("--env-var <name>", "Environment variable that holds the connector's auth token.")
    .option(
      "--config <json>",
      "Per-type config as a JSON string. Required when --type is supplied.",
    )
    .option(
      "--description <text>",
      "Optional short description (prepended to MCP tool descriptions).",
    )
    .action(async (options: AddOptions) => {
      process.exitCode = await runAdd(getContext(), options);
    });

  group
    .command("remove <name>")
    .description("Remove the named connector from citadel.yaml and refresh per-host MCP entries.")
    .option("--yes", "Skip the confirmation prompt.")
    .action(async (name: string, options: { yes?: boolean }) => {
      process.exitCode = await runRemove(getContext(), name, options.yes === true);
    });

  group
    .command("exec <name> <operation> [args...]")
    .description(
      "Fallback dispatch for non-MCP agent hosts. Invokes the named operation; prints the JSON envelope on stdout.",
    )
    .allowUnknownOption(true)
    .action(async (name: string, operation: string, args: string[]) => {
      process.exitCode = await runExec(getContext(), name, operation, args);
    });
}

async function runList(ctx: CliContext): Promise<number> {
  let connectors: Connector[];
  try {
    connectors = await listConnectorsFromCitadel(ctx.repoRoot.path);
  } catch (err) {
    return handleCitadelLoadError(ctx, err);
  }
  if (connectors.length === 0) {
    ctx.prompts.log.info("No connectors configured. Add one with `maester connector add`.");
    return EXIT_OK;
  }
  for (const c of connectors) {
    const tools = toolNamesFor(c);
    const lines = [`• ${c.name} (type: ${c.type})`];
    for (const t of tools) {
      lines.push(`    ${t}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  return EXIT_OK;
}

type AddOptions = {
  type?: string;
  name?: string;
  envVar?: string;
  config?: string;
  description?: string;
};

async function runAdd(ctx: CliContext, options: AddOptions): Promise<number> {
  const isFlagDriven = Boolean(options.type || options.name);
  if (isFlagDriven) {
    return runAddFlagDriven(ctx, options);
  }
  return runAddInteractive(ctx);
}

async function runAddFlagDriven(ctx: CliContext, options: AddOptions): Promise<number> {
  if (!options.type) {
    ctx.logger.error("--type is required when running connector add non-interactively.");
    return EXIT_INVOCATION_ERROR;
  }
  if (!options.name) {
    ctx.logger.error("--name is required when running connector add non-interactively.");
    return EXIT_INVOCATION_ERROR;
  }
  if (!SLUG_RE.test(options.name)) {
    ctx.logger.error(`--name must be kebab-case (matched ${SLUG_RE}).`);
    return EXIT_INVOCATION_ERROR;
  }
  if (!hasConnectorType(options.type)) {
    const known = listConnectorTypes().map((t) => t.id);
    ctx.logger.error(
      `Unknown connector type '${options.type}'.${known.length > 0 ? ` Known types: ${known.join(", ")}` : " No types are registered in this build."}`,
    );
    return EXIT_INVOCATION_ERROR;
  }
  if (options.envVar && !ENV_VAR_RE.test(options.envVar)) {
    ctx.logger.error("--env-var must be UPPER_SNAKE_CASE (matched ^[A-Z][A-Z0-9_]*$).");
    return EXIT_INVOCATION_ERROR;
  }
  let parsedConfig: unknown = {};
  if (options.config) {
    try {
      parsedConfig = JSON.parse(options.config);
    } catch (err) {
      ctx.logger.error(
        `--config must be valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_INVOCATION_ERROR;
    }
  }
  const connector: Connector = {
    name: options.name,
    type: options.type,
    ...(options.description ? { description: options.description } : {}),
    ...(options.envVar ? { auth: { type: "token" as const, envVar: options.envVar } } : {}),
    config: parsedConfig,
  };
  return writeAddAndRefresh(ctx, connector);
}

async function runAddInteractive(ctx: CliContext): Promise<number> {
  const types = listConnectorTypes();
  if (types.length === 0) {
    ctx.prompts.log.warning(
      "No connector types are registered in this build of maester. Cannot add a connector interactively.",
    );
    return EXIT_INVOCATION_ERROR;
  }
  try {
    const typeId = await ctx.prompts.select({
      message: "Connector type",
      options: types.map((t) => ({ value: t.id, label: t.label })),
    });
    const name = await ctx.prompts.text({
      message: "Connector name (unique slug)",
      validate: (v) => (SLUG_RE.test(v) ? undefined : "Must be a kebab-case slug."),
    });
    const description = await ctx.prompts.text({
      message: "Optional description (press enter to skip)",
      initialValue: "",
    });
    const envVar = await ctx.prompts.text({
      message: "Auth env var name (press enter to skip if no auth required)",
      initialValue: "",
      validate: (v) => (!v || ENV_VAR_RE.test(v) ? undefined : "Must be UPPER_SNAKE_CASE."),
    });
    // Per-type config: prompt for raw JSON for now. Each type's prompt module
    // will hook in here once concrete types land. We keep the surface simple.
    const configJson = await ctx.prompts.text({
      message: "Per-type config (JSON)",
      initialValue: "{}",
      validate: (v) => {
        try {
          JSON.parse(v);
          return undefined;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      },
    });
    const connector: Connector = {
      name,
      type: typeId as string,
      ...(description ? { description } : {}),
      ...(envVar ? { auth: { type: "token" as const, envVar } } : {}),
      config: JSON.parse(configJson) as unknown,
    };
    return writeAddAndRefresh(ctx, connector);
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      ctx.prompts.outro("Cancelled — no connector added.");
      return EXIT_INVOCATION_ERROR;
    }
    throw err;
  }
}

async function writeAddAndRefresh(ctx: CliContext, connector: Connector): Promise<number> {
  try {
    const result = await addConnectorToCitadel(ctx.repoRoot.path, connector);
    ctx.prompts.log.success(`Wrote connector '${connector.name}' to ${result.filePath}.`);
    // Gap 47: warn when connector name shadows an existing source name.
    if (result.config.sources.some((s) => s.name === connector.name)) {
      ctx.prompts.log.warning(
        `Connector '${connector.name}' shadows a source with the same name. The two namespaces are separate but reading citadel.yaml may confuse future maintainers.`,
      );
    }
    const refreshOutcomes = await refreshMcpRegistrations(ctx.repoRoot.path);
    reportRefresh(ctx, refreshOutcomes);
    return EXIT_OK;
  } catch (err) {
    return handleCitadelLoadError(ctx, err);
  }
}

async function runRemove(ctx: CliContext, name: string, yes: boolean): Promise<number> {
  if (!yes) {
    try {
      const confirmed = await ctx.prompts.confirm({
        message: `Remove connector '${name}' from citadel.yaml?`,
        initialValue: false,
      });
      if (!confirmed) {
        ctx.prompts.outro("Cancelled — citadel.yaml not modified.");
        return EXIT_OK;
      }
    } catch (err) {
      if (err instanceof PromptCancelledError) {
        ctx.prompts.outro("Cancelled.");
        return EXIT_OK;
      }
      throw err;
    }
  }
  try {
    const result = await removeConnectorFromCitadel(ctx.repoRoot.path, name);
    ctx.prompts.log.success(`Removed connector '${name}' from ${result.filePath}.`);
    const refreshOutcomes = await refreshMcpRegistrations(ctx.repoRoot.path);
    reportRefresh(ctx, refreshOutcomes);
    return EXIT_OK;
  } catch (err) {
    if (err instanceof ConnectorNotFoundError) {
      ctx.logger.error(err.message);
      return EXIT_INVOCATION_ERROR;
    }
    return handleCitadelLoadError(ctx, err);
  }
}

async function runExec(
  ctx: CliContext,
  name: string,
  operation: string,
  rawArgs: string[],
): Promise<number> {
  let config: Awaited<ReturnType<typeof loadCitadelConfig>>;
  try {
    config = await loadCitadelConfig(ctx.repoRoot.path);
  } catch (err) {
    return handleCitadelLoadError(ctx, err);
  }
  const connector = (config.connectors ?? []).find((c) => c.name === name);
  if (!connector) {
    ctx.logger.error(`No connector named '${name}' is configured in citadel.yaml.`);
    return EXIT_INVOCATION_ERROR;
  }
  let args: Record<string, unknown>;
  try {
    args = parseExecArgs(rawArgs);
  } catch (err) {
    ctx.logger.error(err instanceof Error ? err.message : String(err));
    return EXIT_INVOCATION_ERROR;
  }
  const envelope = await invokeOperation({
    connector,
    operationName: operation,
    args,
  });
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  return envelope.ok ? EXIT_OK : EXIT_FALLBACK_FAILURE;
}

/**
 * Parse the trailing `--key value` (or `--key=value`) pairs after `exec name op`
 * into an args object. Repeated keys become arrays. Bare flags become `true`.
 */
function parseExecArgs(raw: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  let i = 0;
  while (i < raw.length) {
    const token = raw[i];
    if (token === undefined) {
      i += 1;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument '${token}'. Use --key value form.`);
    }
    const eqIndex = token.indexOf("=");
    let key: string;
    let value: string | true;
    if (eqIndex >= 0) {
      key = token.slice(2, eqIndex);
      value = token.slice(eqIndex + 1);
      i += 1;
    } else {
      key = token.slice(2);
      const next = raw[i + 1];
      if (next === undefined || next.startsWith("--")) {
        value = true;
        i += 1;
      } else {
        value = next;
        i += 2;
      }
    }
    const existing = args[key];
    if (existing === undefined) {
      args[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      args[key] = [existing, value];
    }
  }
  return args;
}

function reportRefresh(
  ctx: CliContext,
  outcomes: ReadonlyArray<{ host: string; filePath: string; action: string; error?: string }>,
): void {
  if (outcomes.length === 0) {
    ctx.prompts.log.info(
      "No MCP-capable Grand Maester targets installed — skipping MCP config refresh.",
    );
    return;
  }
  for (const o of outcomes) {
    if (o.action === "failed") {
      ctx.prompts.log.error(`MCP refresh failed for ${o.host}${o.error ? `: ${o.error}` : ""}`);
    } else {
      ctx.prompts.log.success(`MCP entry ${o.action} → ${o.filePath}`);
    }
  }
  ctx.prompts.log.info(
    "Restart your agent session to pick up the new tool surface (most host platforms restart MCP servers automatically when their config changes).",
  );
}

function handleCitadelLoadError(ctx: CliContext, err: unknown): number {
  if (err instanceof ConfigError) {
    ctx.logger.error(err.message);
    return EXIT_INVOCATION_ERROR;
  }
  if (err instanceof MaesterError) {
    ctx.logger.error(err.message);
    return EXIT_INVOCATION_ERROR;
  }
  throw err;
}

function toolNamesFor(connector: Connector): string[] {
  if (!hasConnectorType(connector.type)) {
    return [`(unregistered type: ${connector.type})`];
  }
  const type = listConnectorTypes().find((t) => t.id === connector.type);
  if (!type) return [];
  return Object.values(type.operations).map((op) => toolName(connector.name, op.name));
}
