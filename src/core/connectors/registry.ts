import type { ConnectorType } from "./types.js";

/**
 * Compile-time registry of supported connector types. This module is the only
 * place that imports per-type modules; adding a new type is a one-line change.
 *
 * In v1 the production registry is intentionally empty — the GitLab Issues
 * connector lands as its own follow-on feature and is the first entry. Tests
 * register short-lived fixture types via `__registerTestType` below.
 */
const REGISTRY = new Map<string, ConnectorType<unknown>>();

export function listConnectorTypes(): ConnectorType<unknown>[] {
  return [...REGISTRY.values()];
}

export function lookupConnectorType(id: string): ConnectorType<unknown> | undefined {
  return REGISTRY.get(id);
}

export function hasConnectorType(id: string): boolean {
  return REGISTRY.has(id);
}

/**
 * Add a type to the production registry. Called once per type from a per-type
 * module's top-level import effect (e.g. `src/core/connectors/types/<id>/index.ts`).
 * Re-registering the same id throws — type identifiers are write-once.
 */
export function registerConnectorType<T>(type: ConnectorType<T>): void {
  if (REGISTRY.has(type.id)) {
    throw new Error(`Connector type '${type.id}' is already registered.`);
  }
  // Generic erasure is safe — dispatch.ts re-parses the config through the
  // type's own `configSchema` at the chokepoint, restoring concrete typing
  // for the handler call.
  REGISTRY.set(type.id, type as unknown as ConnectorType<unknown>);
}

/**
 * Test-only: register a fixture type and return a disposer that removes it.
 * Production code MUST NOT call this — use `registerConnectorType` instead.
 * Marker prefix (`__`) makes accidental use obvious in reviews.
 */
export function __registerTestType<T>(type: ConnectorType<T>): () => void {
  REGISTRY.set(type.id, type as unknown as ConnectorType<unknown>);
  return () => {
    REGISTRY.delete(type.id);
  };
}
