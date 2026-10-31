import type { Command } from "commander";
import { loadCitadelConfig } from "../../core/config/loader.js";
import { invokeOperation, listConnectorTools } from "../../core/connectors/dispatch.js";
import { hasConnectorType, listConnectorTypes } from "../../core/connectors/registry.js";
import { toolName } from "../../core/connectors/tool-name.js";
import { ConfigError, MaesterError } from "../../core/errors.js";
import {
  ConnectorNotFoundError,
  addConnectorToCitadel,
  listConnectorsFromCitadel,
  removeConnectorFromCitadel,
} from "../../core/init/connector-writer.js";
import {
  findLinkedDestinations,
  linkedDocumentToolDescriptors,
} from "../../core/mcp/linked-docs.js";
import { checkMcpServers, describeWarning, formatFailure } from "../../core/mcp/proxy/index.js";
import {
  type McpRegistrationPlan,
  planMcpRegistrations,
  refreshMcpRegistrations,
} from "../../core/mcp/registrations/index.js";
import { type Connector, ENV_VAR_RE, SLUG_RE, isDirectMcpServer } from "../../schemas/citadel.js";
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
    .command("refresh")
    .description(
      "Re-validate citadel.yaml and refresh per-host MCP registrations. Use this after editing citadel.yaml by hand.",
    )
    .option("--dry-run", "Print what each host's MCP entry would contain; write nothing.")
    .action(async (options: { dryRun?: boolean }) => {
      const ctx = getContext();
      process.exitCode = options.dryRun ? await runRefreshDryRun(ctx) : await runRefresh(ctx);
    });

  group
    .command("tools")
    .description("Print the tool list `maester mcp` would expose, without starting an MCP session.")
    .option("--servers", "Also start proxied MCP servers to list their tools.")
    .action(async (options: { servers?: boolean }) => {
      process.exitCode = await runTools(getContext(), options.servers === true);
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

async function runRefresh(ctx: CliContext): Promise<number> {
  let config: Awaited<ReturnType<typeof loadCitadelConfig>>;
  try {
    config = await loadCitadelConfig(ctx.repoRoot.path);
  } catch (err) {
    return handleCitadelLoadError(ctx, err);
  }
  const count = config.connectors?.length ?? 0;
  ctx.prompts.log.info(
    count === 0
      ? "citadel.yaml has no connectors. Refreshing per-host MCP entries anyway so the maester server stays registered."
      : `citadel.yaml lists ${count} connector${count === 1 ? "" : "s"}. Refreshing per-host MCP entries.`,
  );
  const outcomes = await refreshMcpRegistrations(ctx.repoRoot.path);
  reportRefresh(ctx, outcomes);
  return EXIT_OK;
}

async function runRefreshDryRun(ctx: CliContext): Promise<number> {
  try {
    await loadCitadelConfig(ctx.repoRoot.path);
  } catch (err) {
    return handleCitadelLoadError(ctx, err);
  }
  const { inputs, hosts } = await planMcpRegistrations(ctx.repoRoot.path);
  if (ctx.flags.json) {
    for (const h of hosts) {
      const contributors = Object.fromEntries(
        h.forwardedEnvVars.map((n) => [n, inputs.contributors[n] ?? []]),
      );
      process.stdout.write(`${JSON.stringify({ ...h, contributors })}\n`);
    }
    return hosts.some((h) => h.error !== undefined) ? EXIT_INVOCATION_ERROR : EXIT_OK;
  }
  for (const entry of inputs.invalid) {
    process.stdout.write(
      `! connector '${entry.connector}' declares invalid env-var name '${entry.envVar}' — not forwarded\n`,
    );
  }
  if (hosts.length === 0) {
    process.stdout.write(
      "No MCP-capable Grand Maester targets installed — a refresh would write nothing.\n",
    );
    return EXIT_OK;
  }
  for (const h of hosts) process.stdout.write(formatPlan(h, inputs.managed, inputs.contributors));
  process.stdout.write("Dry run — no files written.\n");
  return hosts.some((h) => h.error !== undefined) ? EXIT_INVOCATION_ERROR : EXIT_OK;
}

function formatPlan(
  h: McpRegistrationPlan,
  declared: readonly string[],
  contributors: Readonly<Record<string, readonly string[]>>,
): string {
  const lines = [`${h.host} → ${h.filePath}`];
  if (h.error !== undefined) {
    lines.push(`  ✗ cannot render: ${h.error}`);
    return `${lines.join("\n")}\n\n`;
  }
  lines.push(`  ${h.wouldChange ? "would be rewritten" : "up to date"}`);
  if (h.host === "cursor") {
    lines.push("  env: no env forwarding — inherits the shell that launches Cursor");
    for (const name of declared) {
      lines.push(`    needs ${name}  (${(contributors[name] ?? []).join(", ")})`);
    }
  } else if (h.forwardedEnvVars.length === 0) {
    lines.push("  env forwarded: (none)");
  } else {
    lines.push("  env forwarded:");
    for (const name of h.forwardedEnvVars) {
      lines.push(`    ${name}  (${(contributors[name] ?? []).join(", ")})`);
    }
  }
  if (h.userEnvVars.length > 0) {
    lines.push(`  env added by hand (kept): ${h.userEnvVars.join(", ")}`);
  }
  if (h.directWritten.length > 0) lines.push(`  direct servers: ${h.directWritten.join(", ")}`);
  if (h.directRemoved.length > 0) {
    lines.push(`  direct servers removed: ${h.directRemoved.join(", ")}`);
  }
  for (const skip of h.skipped) lines.push(`  ! ${skip.server} not registered: ${skip.reason}`);
  return `${lines.join("\n")}\n\n`;
}

type ToolListing = { name: string; description?: string; inputSchema: Record<string, unknown> };

async function runTools(ctx: CliContext, startServers: boolean): Promise<number> {
  let config: Awaited<ReturnType<typeof loadCitadelConfig>>;
  try {
    config = await loadCitadelConfig(ctx.repoRoot.path);
  } catch (err) {
    return handleCitadelLoadError(ctx, err);
  }
  const tools: ToolListing[] = [...listConnectorTools(config)];
  if ((await findLinkedDestinations(config, ctx.repoRoot.path)).length > 0) {
    tools.push(...linkedDocumentToolDescriptors());
  }
  const servers = config.mcpServers ?? [];
  const proxied = servers.filter((s) => !isDirectMcpServer(s));
  const notes: string[] = [];
  let failed = 0;
  if (startServers && proxied.length > 0) {
    const report = await checkMcpServers(config, process.env);
    for (const s of report.servers) {
      if ("direct" in s) continue;
      if (!s.ok) {
        failed++;
        notes.push(`✗ ${s.server}: ${formatFailure(s.failure)}`);
        continue;
      }
      for (const t of s.tools) {
        tools.push({
          name: t.name,
          ...(t.description !== undefined ? { description: t.description } : {}),
          inputSchema: t.inputSchema as Record<string, unknown>,
        });
      }
      for (const w of s.warnings) notes.push(`! ${s.server}: ${describeWarning(w)}`);
    }
  } else {
    for (const s of proxied) {
      notes.push(`– ${s.name}: proxied — pass --servers to start it and list its tools`);
    }
  }
  for (const s of servers.filter(isDirectMcpServer)) {
    notes.push(`– ${s.name}: host-managed (register: direct) — its tools come from the host`);
  }

  if (ctx.flags.json) {
    process.stdout.write(`${JSON.stringify({ tools })}\n`);
  } else {
    for (const t of tools) process.stdout.write(formatTool(t));
    for (const note of notes) process.stdout.write(`${note}\n`);
    process.stdout.write(
      `${tools.length} tool${tools.length === 1 ? "" : "s"} (* marks a required argument)\n`,
    );
  }
  return failed > 0 ? EXIT_FALLBACK_FAILURE : EXIT_OK;
}

function formatTool(tool: ToolListing): string {
  const props = tool.inputSchema.properties;
  const required = new Set(
    Array.isArray(tool.inputSchema.required) ? (tool.inputSchema.required as string[]) : [],
  );
  const args =
    typeof props === "object" && props !== null
      ? Object.keys(props).map((k) => (required.has(k) ? `${k}*` : k))
      : [];
  const lines = [tool.name];
  if (tool.description) lines.push(`  ${tool.description.split("\n")[0]}`);
  lines.push(`  args: ${args.length > 0 ? args.join(", ") : "(none)"}`);
  return `${lines.join("\n")}\n`;
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

export function reportRefresh(
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
