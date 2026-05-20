export { loadCitadelConfig, loadMaesterConfig } from "./core/config/loader.js";
export { runSync } from "./core/sync/runner.js";
export type {
  SyncOutcome,
  SyncResult,
  SyncStatus,
  SyncOptions,
  ProgressEvent,
} from "./core/sync/runner.js";
export { runStatus } from "./core/status/runner.js";
export type {
  BehindReason,
  StatusCounts,
  StatusOptions,
  StatusOutcome,
  StatusResult,
  StatusVerdict,
} from "./core/status/runner.js";
export {
  listSkillTargets,
  runSkillInstall,
  runSkillStatus,
  runSkillUpgrade,
} from "./core/skill/runner.js";
export type {
  SkillAction,
  SkillInstallOutcome,
  SkillInstallResult,
  SkillStatusOutcome,
  SkillStatusResult,
  SkillTarget,
  SkillTargetId,
} from "./core/skill/types.js";
export { SKILL_VERSION } from "./core/skill/version.js";
export {
  buildToolDescription,
  findOperationByToolName,
  invokeOperation,
  listConnectorTools,
} from "./core/connectors/dispatch.js";
export {
  hasConnectorType,
  listConnectorTypes,
  lookupConnectorType,
  registerConnectorType,
} from "./core/connectors/registry.js";
export {
  CONNECTOR_ERROR_CODES,
  ENVELOPE_SCHEMA_VERSION,
  defineConnectorOperation,
} from "./core/connectors/types.js";
export { ConnectorError } from "./core/connectors/errors.js";
export type {
  ConnectorContext,
  ConnectorErrorCode,
  ConnectorErrorPayload,
  ConnectorFailureEnvelope,
  ConnectorOperation,
  ConnectorResultEnvelope,
  ConnectorSuccessEnvelope,
  ConnectorToolDescriptor,
  ConnectorType,
} from "./core/connectors/types.js";
export type { CitadelConfig, Connector, Source, AuthRef } from "./schemas/citadel.js";
export type { MaesterConfig, PublishedDocument } from "./schemas/maester.js";
export {
  ConfigError,
  AuthError,
  RefNotFoundError,
  DestinationBlockedError,
  MaesterError,
} from "./core/errors.js";
