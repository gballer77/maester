import type { CitadelConfig, Connector } from "../../schemas/citadel.js";
import { loadCitadelConfig } from "../config/loader.js";
import { writeCitadelConfig } from "../config/writer.js";
import { MaesterError } from "../errors.js";

export class ConnectorNotFoundError extends MaesterError {
  readonly connectorName: string;
  constructor(name: string) {
    super("CONNECTOR_NOT_FOUND", `No connector named '${name}' is configured in citadel.yaml.`);
    this.name = "ConnectorNotFoundError";
    this.connectorName = name;
  }
}

export class DuplicateConnectorError extends MaesterError {
  readonly connectorName: string;
  constructor(name: string) {
    super(
      "DUPLICATE_CONNECTOR",
      `A connector named '${name}' is already declared in citadel.yaml.`,
    );
    this.name = "DuplicateConnectorError";
    this.connectorName = name;
  }
}

/**
 * Append `connector` to the citadel's connectors array and write the file
 * back. Rejects when a connector with the same name already exists. The
 * citadel config is re-validated on read; downstream errors (unknown type,
 * invalid per-type config, duplicate names) surface from `loadCitadelConfig`.
 */
export async function addConnectorToCitadel(
  repoRoot: string,
  connector: Connector,
): Promise<{ filePath: string; config: CitadelConfig }> {
  const config = await loadCitadelConfig(repoRoot);
  const existing = config.connectors ?? [];
  if (existing.some((c) => c.name === connector.name)) {
    throw new DuplicateConnectorError(connector.name);
  }
  const next: CitadelConfig = {
    ...config,
    connectors: [...existing, connector],
  };
  const filePath = await writeCitadelConfig(repoRoot, next);
  return { filePath, config: next };
}

/**
 * Remove the connector named `name` and write the file back. Throws
 * `ConnectorNotFoundError` if no entry matches.
 */
export async function removeConnectorFromCitadel(
  repoRoot: string,
  name: string,
): Promise<{ filePath: string; config: CitadelConfig }> {
  const config = await loadCitadelConfig(repoRoot);
  const existing = config.connectors ?? [];
  const index = existing.findIndex((c) => c.name === name);
  if (index === -1) {
    throw new ConnectorNotFoundError(name);
  }
  const next: CitadelConfig = {
    ...config,
    connectors: existing.filter((_, i) => i !== index),
  };
  const filePath = await writeCitadelConfig(repoRoot, next);
  return { filePath, config: next };
}

/**
 * Read connectors from the citadel without mutating anything. Returns the
 * empty array when no connectors are declared.
 */
export async function listConnectorsFromCitadel(repoRoot: string): Promise<Connector[]> {
  const config = await loadCitadelConfig(repoRoot);
  return [...(config.connectors ?? [])];
}
