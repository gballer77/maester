import { type CitadelConfig, CitadelConfigSchema, type McpServer } from "../../schemas/citadel.js";
import { loadCitadelConfig } from "../config/loader.js";
import { writeCitadelConfig } from "../config/writer.js";
import { ConfigError, MaesterError } from "../errors.js";

export class McpServerNotFoundError extends MaesterError {
  constructor(name: string) {
    super("MCP_SERVER_NOT_FOUND", `No MCP server named '${name}' is declared in citadel.yaml.`);
    this.name = "McpServerNotFoundError";
  }
}

/**
 * Append `server` to `mcpServers` and write `citadel.yaml`. The whole config is
 * re-validated before writing, so a duplicate or reserved name (Gap 57)
 * surfaces as a `ConfigError` and nothing is written.
 */
export async function addMcpServerToCitadel(
  repoRoot: string,
  server: McpServer,
): Promise<{ filePath: string; config: CitadelConfig }> {
  const config = await loadCitadelConfig(repoRoot);
  const next: CitadelConfig = { ...config, mcpServers: [...(config.mcpServers ?? []), server] };
  assertValid(next);
  const filePath = await writeCitadelConfig(repoRoot, next);
  return { filePath, config: next };
}

export async function removeMcpServerFromCitadel(
  repoRoot: string,
  name: string,
): Promise<{ filePath: string; config: CitadelConfig; removed: McpServer }> {
  const config = await loadCitadelConfig(repoRoot);
  const existing = config.mcpServers ?? [];
  const removed = existing.find((s) => s.name === name);
  if (!removed) throw new McpServerNotFoundError(name);
  const next: CitadelConfig = { ...config, mcpServers: existing.filter((s) => s !== removed) };
  const filePath = await writeCitadelConfig(repoRoot, next);
  return { filePath, config: next, removed };
}

export async function listMcpServersFromCitadel(repoRoot: string): Promise<McpServer[]> {
  const config = await loadCitadelConfig(repoRoot);
  return [...(config.mcpServers ?? [])];
}

function assertValid(config: CitadelConfig): void {
  const result = CitadelConfigSchema.safeParse(config);
  if (result.success) return;
  const issue = result.error.issues[0];
  const where = issue?.path?.length ? ` at \`${issue.path.join(".")}\`` : "";
  throw new ConfigError(`citadel.yaml: ${issue?.message ?? "validation failed"}${where}`);
}
