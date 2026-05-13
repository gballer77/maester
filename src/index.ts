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
export type { CitadelConfig, Source, AuthRef } from "./schemas/citadel.js";
export type { MaesterConfig, PublishedDocument } from "./schemas/maester.js";
export {
  ConfigError,
  AuthError,
  RefNotFoundError,
  DestinationBlockedError,
  MaesterError,
} from "./core/errors.js";
