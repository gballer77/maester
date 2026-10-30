import type { Command } from "commander";
import { loadCitadelConfig } from "../../core/config/loader.js";
import { listConnectorTools } from "../../core/connectors/dispatch.js";
import { ConfigError, MaesterError } from "../../core/errors.js";
import {
  McpServerNotFoundError,
  addMcpServerToCitadel,
  listMcpServersFromCitadel,
  removeMcpServerFromCitadel,
} from "../../core/init/mcp-server-writer.js";
import { formatArgv, splitArgs } from "../../core/mcp/proxy/argv.js";
import {
  type CheckReport,
  checkMcpServers,
  describeWarning,
  formatFailure,
} from "../../core/mcp/proxy/index.js";
import { mcpServerEnvVarNames } from "../../core/mcp/registrations/env-vars.js";
import { refreshMcpRegistrations } from "../../core/mcp/registrations/index.js";
import {
  ENV_VAR_RE,
  MCP_SERVER_NAME_MAX,
  MCP_SERVER_NAME_RE,
  type McpServer,
  McpServerSchema,
  RESERVED_TOOL_PREFIXES,
  isDirectMcpServer,
} from "../../schemas/citadel.js";
import { renderBox } from "../../ui/components/box.js";
import { renderTable } from "../../ui/components/table.js";
import { PromptCancelledError } from "../../ui/prompts.js";
import type { CliContext } from "../context.js";
import { reportRefresh } from "./connector.js";

const EXIT_OK = 0;
const EXIT_CHECK_FAILED = 1;
const EXIT_INVOCATION_ERROR = 2;

const RESTART_REMINDER = "Restart your agent session so it picks up the change to its MCP servers.";

export function registerMcpServer(program: Command, getContext: () => CliContext): void {
  const group = program
    .command("mcp-server")
    .description(
      "Manage third-party MCP servers declared in citadel.yaml (proxied behind `maester mcp`, or registered directly with each agent host).",
    );

  group
    .command("add")
    .description("Declare a third-party MCP server. Interactive when --name is not passed.")
    .option("--name <name>", "Unique server name (lowercase, digits, '-'; at most 32 chars).")
    .option("--kind <kind>", "local (maester starts a command) or remote (an HTTP endpoint).")
    .option("--command <command>", "Local: the executable to run (no shell is used).")
    .option("--args <string>", "Local: arguments, split with shell-style quoting.")
    .option("--url <url>", "Remote: the Streamable HTTP endpoint (https://).")
    .option("--env-var <name...>", "Local: env-var NAMES forwarded to the server.")
    .option("--auth-env-var <name>", "Remote: env-var NAME holding the token.")
    .option(
      "--auth-header <header>",
      "Remote: header to send the token in (default Authorization: Bearer).",
    )
    .option("--register <mode>", "proxy (default) or direct.")
    .option("--tools <names...>", "Optional allowlist of upstream tool names.")
    .option("--description <text>", "Optional description.")
    .option("--yes", "Save without the confirmation prompt.")
    .action(async (options: AddOptions) => {
      process.exitCode = await runAdd(getContext(), options);
    });

  group
    .command("remove <name>")
    .description("Remove a declared MCP server and refresh every host registration.")
    .option("--yes", "Skip the confirmation prompt.")
    .action(async (name: string, options: { yes?: boolean }) => {
      process.exitCode = await runRemove(getContext(), name, options.yes === true);
    });

  group
    .command("list")
    .description("List declared MCP servers: name, kind, mode, and env-var names.")
    .action(async () => {
      process.exitCode = await runList(getContext());
    });

  group
    .command("check [names...]")
    .description(
      "Start or connect to each proxied server and report its tools, or why it failed. Exits 1 when any server fails.",
    )
    .action(async (names: string[]) => {
      process.exitCode = await runCheck(getContext(), names);
    });
}

type AddOptions = {
  name?: string;
  kind?: string;
  command?: string;
  args?: string;
  url?: string;
  envVar?: string[];
  authEnvVar?: string;
  authHeader?: string;
  register?: string;
  tools?: string[];
  description?: string;
  yes?: boolean;
};

async function runAdd(ctx: CliContext, options: AddOptions): Promise<number> {
  let server: McpServer;
  try {
    if (options.name) {
      const built = buildFromFlags(options);
      if (typeof built === "string") {
        ctx.logger.error(built);
        return EXIT_INVOCATION_ERROR;
      }
      server = built;
    } else {
      const taken = await takenNames(ctx);
      if (taken === undefined) return EXIT_INVOCATION_ERROR;
      server = await promptMcpServer(ctx, taken);
    }
    if (!options.yes && !(await confirmServer(ctx, server))) {
      ctx.prompts.outro("Cancelled — citadel.yaml not modified.");
      return EXIT_OK;
    }
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      ctx.prompts.outro("Cancelled — no MCP server added.");
      return EXIT_INVOCATION_ERROR;
    }
    throw err;
  }

  try {
    const result = await addMcpServerToCitadel(ctx.repoRoot.path, server);
    ctx.prompts.log.success(`Wrote MCP server '${server.name}' to ${result.filePath}.`);
    await refreshAndRemind(ctx);
    const names = mcpServerEnvVarNames(server);
    if (names.length > 0) {
      ctx.prompts.log.info(`Export before starting your agent: ${names.join(", ")}`);
    }
    return EXIT_OK;
  } catch (err) {
    return handleLoadError(ctx, err);
  }
}

/** Assemble and validate a server from `add` flags; returns an error message on failure. */
function buildFromFlags(options: AddOptions): McpServer | string {
  const common = {
    name: options.name,
    ...(options.description ? { description: options.description } : {}),
    ...(options.register ? { register: options.register } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
  };
  let candidate: Record<string, unknown>;
  if (options.kind === "local") {
    let args: string[] = [];
    try {
      args = options.args ? splitArgs(options.args) : [];
    } catch (err) {
      return `--args: ${err instanceof Error ? err.message : String(err)}`;
    }
    candidate = {
      ...common,
      kind: "local",
      command: options.command,
      ...(args.length > 0 ? { args } : {}),
      ...(options.envVar ? { envVars: options.envVar } : {}),
    };
  } else if (options.kind === "remote") {
    candidate = {
      ...common,
      kind: "remote",
      url: options.url,
      ...(options.authEnvVar
        ? {
            auth: {
              envVar: options.authEnvVar,
              ...(options.authHeader ? { header: options.authHeader } : {}),
            },
          }
        : {}),
    };
  } else {
    return "--kind must be 'local' or 'remote'.";
  }
  const parsed = McpServerSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.length ? issue.path.join(".") : "entry";
  return `MCP server '${options.name}': ${field}: ${issue?.message ?? "invalid"}`;
}

async function takenNames(ctx: CliContext): Promise<Set<string> | undefined> {
  try {
    const config = await loadCitadelConfig(ctx.repoRoot.path);
    return new Set([
      ...(config.connectors ?? []).map((c) => c.name),
      ...(config.mcpServers ?? []).map((s) => s.name),
    ]);
  } catch (err) {
    handleLoadError(ctx, err);
    return undefined;
  }
}

/**
 * The shared interactive sub-flow used by `mcp-server add` and by init
 * (architecture §6.17). `taken` holds connector + server names already in use.
 */
export async function promptMcpServer(
  ctx: CliContext,
  taken: ReadonlySet<string>,
): Promise<McpServer> {
  const name = await ctx.prompts.text({
    message: "MCP server name (becomes the <name>__ tool prefix)",
    validate: (v) => validateName(v, taken),
  });
  const kind = await ctx.prompts.select({
    message: "Kind",
    options: [
      { value: "local" as const, label: "Local — maester starts a command" },
      { value: "remote" as const, label: "Remote — an HTTP endpoint" },
    ],
  });
  const description = await ctx.prompts.text({
    message: "Optional description (press enter to skip)",
    initialValue: "",
  });
  const register = await ctx.prompts.select({
    message: "How should agent hosts reach it?",
    options: [
      { value: "proxy" as const, label: "Proxy through maester", hint: "one entry, every host" },
      {
        value: "direct" as const,
        label: "Register directly with each host",
        hint: "for servers that need the host's own sign-in",
      },
    ],
  });
  const common = {
    name,
    ...(description ? { description } : {}),
    ...(register === "direct" ? { register } : {}),
  };

  if (kind === "local") {
    const command = await ctx.prompts.text({
      message: "Command to run (no shell is used)",
      validate: (v) => (v.trim().length > 0 && v.trim() === v ? undefined : "Enter a command."),
    });
    const argsText = await ctx.prompts.text({
      message: "Arguments (shell-style quoting; press enter for none)",
      initialValue: "",
      validate: (v) => {
        try {
          splitArgs(v);
          return undefined;
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
      },
    });
    const envText = await ctx.prompts.text({
      message: "Env-var NAMES to forward, comma-separated (press enter for none)",
      initialValue: "",
      validate: validateEnvVarList,
    });
    const args = splitArgs(argsText);
    const envVars = splitList(envText);
    return {
      ...common,
      kind: "local",
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(envVars.length > 0 ? { envVars } : {}),
    };
  }

  const url = await ctx.prompts.text({
    message: "Server URL (https://…)",
    validate: (v) =>
      McpServerSchema.safeParse({ name: "x", kind: "remote", url: v }).success
        ? undefined
        : "Use an https:// URL (http:// only for localhost).",
  });
  const envVar = await ctx.prompts.text({
    message: "Env-var NAME holding the token (press enter if none)",
    initialValue: "",
    validate: (v) => (v === "" ? undefined : validateEnvVarName(v)),
  });
  let header = "";
  if (envVar) {
    header = await ctx.prompts.text({
      message: "Header to send it in (press enter for Authorization: Bearer)",
      initialValue: "",
      validate: (v) =>
        v === "" || /^[A-Za-z0-9-]+$/.test(v) ? undefined : "Enter an HTTP header name.",
    });
  }
  return {
    ...common,
    kind: "remote",
    url,
    ...(envVar ? { auth: { envVar, ...(header ? { header } : {}) } } : {}),
  };
}

function validateName(value: string, taken: ReadonlySet<string>): string | undefined {
  if (!MCP_SERVER_NAME_RE.test(value)) {
    return "Start with a lowercase letter; use lowercase letters, digits, and '-'.";
  }
  if (value.length > MCP_SERVER_NAME_MAX) return `At most ${MCP_SERVER_NAME_MAX} characters.`;
  if ((RESERVED_TOOL_PREFIXES as readonly string[]).includes(value))
    return `'${value}' is reserved.`;
  if (taken.has(value)) return `'${value}' is already used by a connector or MCP server.`;
  return undefined;
}

/** Name-vs-value guard (§7): the message never echoes what was typed. */
function validateEnvVarName(value: string): string | undefined {
  return ENV_VAR_RE.test(value)
    ? undefined
    : "Enter the env-var NAME (e.g. TRACKER_TOKEN), not its value.";
}

function validateEnvVarList(value: string): string | undefined {
  for (const name of splitList(value)) {
    const problem = validateEnvVarName(name);
    if (problem) return problem;
  }
  return undefined;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Show the exact argv or URL before anything is saved (PRD P1, §7 rule 6). */
async function confirmServer(ctx: CliContext, server: McpServer): Promise<boolean> {
  process.stdout.write(`${renderBox(ctx.theming, describeServer(server).join("\n"))}\n`);
  return ctx.prompts.confirm({ message: `Save MCP server '${server.name}'?`, initialValue: true });
}

export function describeServer(server: McpServer): string[] {
  const lines = [
    `${server.name} (${server.kind}, ${isDirectMcpServer(server) ? "direct" : "proxy"})`,
  ];
  if (server.kind === "local") {
    lines.push(`runs: ${formatArgv([server.command, ...(server.args ?? [])])}`);
  } else {
    lines.push(`url:  ${server.url}`);
    if (server.auth) {
      const header = server.auth.header ?? "Authorization";
      lines.push(
        `auth: ${header}: ${header.toLowerCase() === "authorization" ? "Bearer " : ""}$${server.auth.envVar}`,
      );
    }
  }
  const names = mcpServerEnvVarNames(server);
  if (names.length > 0) lines.push(`env:  ${names.join(", ")}`);
  if (server.tools) lines.push(`tools: ${server.tools.join(", ")}`);
  return lines;
}

async function runRemove(ctx: CliContext, name: string, yes: boolean): Promise<number> {
  if (!yes) {
    try {
      const confirmed = await ctx.prompts.confirm({
        message: `Remove MCP server '${name}' from citadel.yaml?`,
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
    const result = await removeMcpServerFromCitadel(ctx.repoRoot.path, name);
    ctx.prompts.log.success(`Removed MCP server '${name}' from ${result.filePath}.`);
    await refreshAndRemind(ctx);
    return EXIT_OK;
  } catch (err) {
    if (err instanceof McpServerNotFoundError) {
      ctx.logger.error(err.message);
      return EXIT_INVOCATION_ERROR;
    }
    return handleLoadError(ctx, err);
  }
}

async function refreshAndRemind(ctx: CliContext): Promise<void> {
  const outcomes = await refreshMcpRegistrations(ctx.repoRoot.path);
  reportRefresh(ctx, outcomes);
  // reportRefresh already reminds when it updated a host.
  if (outcomes.length === 0) ctx.prompts.log.info(RESTART_REMINDER);
}

async function runList(ctx: CliContext): Promise<number> {
  let servers: McpServer[];
  try {
    servers = await listMcpServersFromCitadel(ctx.repoRoot.path);
  } catch (err) {
    return handleLoadError(ctx, err);
  }
  if (ctx.flags.json) {
    for (const s of servers) {
      process.stdout.write(
        `${JSON.stringify({
          name: s.name,
          kind: s.kind,
          mode: isDirectMcpServer(s) ? "direct" : "proxy",
          envVars: mcpServerEnvVarNames(s),
          ...(s.description ? { description: s.description } : {}),
        })}\n`,
      );
    }
    return EXIT_OK;
  }
  if (servers.length === 0) {
    ctx.prompts.log.info("No MCP servers declared. Add one with `maester mcp-server add`.");
    return EXIT_OK;
  }
  const table = renderTable(ctx.theming, {
    columns: [
      { header: "Name", key: "name" },
      { header: "Kind", key: "kind" },
      { header: "Mode", key: "mode" },
      { header: "Env vars", key: "env" },
      { header: "Description", key: "description" },
    ],
    rows: servers.map((s) => ({
      name: s.name,
      kind: s.kind,
      mode: isDirectMcpServer(s) ? "direct" : "proxy",
      env: mcpServerEnvVarNames(s).join(", ") || "—",
      description: s.description ?? "",
    })),
  });
  process.stdout.write(`${table}\n`);
  return EXIT_OK;
}

async function runCheck(ctx: CliContext, names: string[]): Promise<number> {
  let config: Awaited<ReturnType<typeof loadCitadelConfig>>;
  try {
    config = await loadCitadelConfig(ctx.repoRoot.path);
  } catch (err) {
    return handleLoadError(ctx, err);
  }
  const declared = new Set((config.mcpServers ?? []).map((s) => s.name));
  const unknown = names.filter((n) => !declared.has(n));
  if (unknown.length > 0) {
    ctx.logger.error(
      `No MCP server named ${unknown.map((n) => `'${n}'`).join(", ")} in citadel.yaml.`,
    );
    return EXIT_INVOCATION_ERROR;
  }
  if (declared.size === 0) {
    ctx.prompts.log.info("No MCP servers declared. Add one with `maester mcp-server add`.");
    return EXIT_OK;
  }
  const report = await checkMcpServers(config, process.env, { names });
  const connectorToolCount = listConnectorTools(config).length;
  const totalTools = connectorToolCount + report.proxiedToolCount;
  const ignoredAllowlists = (config.mcpServers ?? []).filter(
    (s) => isDirectMcpServer(s) && s.tools && (names.length === 0 || names.includes(s.name)),
  );

  if (ctx.flags.json) {
    for (const s of report.servers) process.stdout.write(`${JSON.stringify(checkJson(s))}\n`);
    process.stdout.write(
      `${JSON.stringify({ summary: true, failed: failedCount(report), connectorTools: connectorToolCount, proxiedTools: report.proxiedToolCount, totalTools })}\n`,
    );
  } else {
    for (const s of report.servers) {
      if ("direct" in s) {
        process.stdout.write(`– ${s.server}: host-managed (register: direct) — not checked\n`);
        continue;
      }
      if (!s.ok) {
        process.stdout.write(`✗ ${s.server}: ${formatFailure(s.failure)}\n`);
        continue;
      }
      process.stdout.write(
        `✓ ${s.server}: ${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}\n`,
      );
      for (const t of s.tools) process.stdout.write(`    ${t.name}\n`);
      for (const w of s.warnings) process.stdout.write(`    ! ${describeWarning(w)}\n`);
    }
    for (const s of ignoredAllowlists) {
      process.stdout.write(`! ${s.name}: the tools allowlist is ignored for direct servers\n`);
    }
    process.stdout.write(
      `Total tools exposed by maester: ${totalTools} (${connectorToolCount} connector, ${report.proxiedToolCount} proxied)\n`,
    );
  }
  return failedCount(report) > 0 ? EXIT_CHECK_FAILED : EXIT_OK;
}

function failedCount(report: CheckReport): number {
  return report.servers.filter((s) => !("direct" in s) && !s.ok).length;
}

function checkJson(s: CheckReport["servers"][number]): Record<string, unknown> {
  if ("direct" in s) return { server: s.server, status: "direct" };
  if (!s.ok) {
    return {
      server: s.server,
      status: "failed",
      reason: s.failure.reason,
      ...(s.failure.detail ? { detail: s.failure.detail } : {}),
    };
  }
  return {
    server: s.server,
    status: "ok",
    tools: s.tools.map((t) => t.name),
    warnings: s.warnings,
  };
}

function handleLoadError(ctx: CliContext, err: unknown): number {
  if (err instanceof ConfigError || err instanceof MaesterError) {
    ctx.logger.error(err.message);
    return EXIT_INVOCATION_ERROR;
  }
  throw err;
}
