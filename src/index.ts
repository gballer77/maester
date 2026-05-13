export { loadCitadelConfig, loadMaesterConfig } from "./core/config/loader.js";
export { runSync } from "./core/sync/runner.js";
export type {
  SyncOutcome,
  SyncResult,
  SyncStatus,
  SyncOptions,
  ProgressEvent,
} from "./core/sync/runner.js";
export type {
  CitadelConfig,
  MaesterSource,
  RavenSource,
  AuthRef,
} from "./schemas/citadel.js";
export type {
  MaesterConfig,
  PublishedDocument,
} from "./schemas/maester.js";
export {
  ConfigError,
  AuthError,
  RefNotFoundError,
  DestinationBlockedError,
  MaesterError,
} from "./core/errors.js";
