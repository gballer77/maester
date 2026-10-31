import { refreshMcpRegistrations } from "../mcp/registrations/index.js";
import { dedupeTargets, getTarget, listSkillTargets } from "./targets/index.js";
import {
  SKILL_KINDS,
  type SkillInstallOutcome,
  type SkillInstallResult,
  type SkillKind,
  type SkillStatusOutcome,
  type SkillStatusResult,
  type SkillTargetId,
} from "./types.js";
import { SKILL_VERSION } from "./version.js";

const MCP_HOST_IDS: readonly SkillTargetId[] = ["claude-code", "cursor", "codex"];

function selectMcpHosts(targetIds: readonly SkillTargetId[]): SkillTargetId[] {
  return targetIds.filter((id): id is SkillTargetId => MCP_HOST_IDS.includes(id));
}

export type RunSkillInstallOpts = {
  /** Defaults to the Grand Maester. The Publisher needs no MCP refresh (§6.19). */
  kind?: SkillKind;
  targets: readonly SkillTargetId[];
  mode: "install" | "add-target";
  citadelBaseDir: string;
};

export async function runSkillInstall(
  repoRoot: string,
  opts: RunSkillInstallOpts,
): Promise<SkillInstallResult> {
  if (opts.targets.length === 0) {
    throw new Error("At least one target id must be supplied.");
  }
  const kind = opts.kind ?? "grand-maester";
  // Validate every requested id before any write.
  const targets = opts.targets.map((id) => getTarget(id, kind));
  const groups = dedupeTargets(targets);
  const outcomes: SkillInstallOutcome[] = [];
  for (const group of groups.map((g) => ({ ...g, kind }))) {
    const writeOutcome = await safeWrite(group.primary.write, {
      repoRoot,
      skillVersion: SKILL_VERSION,
      citadelBaseDir: opts.citadelBaseDir,
    });
    for (let i = 0; i < group.ids.length; i += 1) {
      const idValue = group.ids[i];
      const labelValue = group.labels[i];
      if (idValue === undefined || labelValue === undefined) continue;
      outcomes.push({
        kind: group.kind,
        id: idValue,
        label: labelValue,
        artifactPaths: group.artifactPaths,
        action: writeOutcome.action,
        ...(writeOutcome.installedVersion !== undefined
          ? { installedVersion: writeOutcome.installedVersion }
          : {}),
        ...(writeOutcome.error !== undefined ? { error: writeOutcome.error } : {}),
      });
    }
  }
  const mcpHosts = kind === "grand-maester" ? selectMcpHosts(opts.targets) : [];
  const mcpRegistrations =
    mcpHosts.length > 0 ? await refreshMcpRegistrations(repoRoot, { scopeTo: mcpHosts }) : [];
  return { outcomes, counts: countOutcomes(outcomes), mcpRegistrations };
}

export type RunSkillUpgradeOpts = {
  /** Restrict to one skill kind; every installed kind when omitted. */
  kinds?: readonly SkillKind[];
  check?: boolean;
  citadelBaseDir: string;
};

export async function runSkillUpgrade(
  repoRoot: string,
  opts: RunSkillUpgradeOpts,
): Promise<SkillInstallResult> {
  const installedGroups = await findInstalledGroups(repoRoot, opts.kinds ?? SKILL_KINDS);
  if (installedGroups.length === 0) {
    return { outcomes: [], counts: countOutcomes([]), mcpRegistrations: [] };
  }
  const outcomes: SkillInstallOutcome[] = [];
  for (const group of installedGroups) {
    const installedVersion = await group.primary.readInstalledVersion(repoRoot);
    const isOutdated = installedVersion !== SKILL_VERSION;
    if (opts.check === true) {
      const action = isOutdated ? "upgraded" : "unchanged";
      for (let i = 0; i < group.ids.length; i += 1) {
        const idValue = group.ids[i];
        const labelValue = group.labels[i];
        if (idValue === undefined || labelValue === undefined) continue;
        outcomes.push({
          kind: group.kind,
          id: idValue,
          label: labelValue,
          artifactPaths: group.artifactPaths,
          action,
          ...(installedVersion !== undefined ? { installedVersion } : {}),
        });
      }
      continue;
    }
    const writeOutcome = await safeWrite(group.primary.write, {
      repoRoot,
      skillVersion: SKILL_VERSION,
      citadelBaseDir: opts.citadelBaseDir,
    });
    for (let i = 0; i < group.ids.length; i += 1) {
      const idValue = group.ids[i];
      const labelValue = group.labels[i];
      if (idValue === undefined || labelValue === undefined) continue;
      outcomes.push({
        kind: group.kind,
        id: idValue,
        label: labelValue,
        artifactPaths: group.artifactPaths,
        action: writeOutcome.action,
        ...(writeOutcome.installedVersion !== undefined
          ? { installedVersion: writeOutcome.installedVersion }
          : {}),
        ...(writeOutcome.error !== undefined ? { error: writeOutcome.error } : {}),
      });
    }
  }
  // Refresh MCP registrations for every installed MCP-capable host —
  // upgrade can run after a connector was added between sessions.
  const upgradesGrandMaester = installedGroups.some((g) => g.kind === "grand-maester");
  const mcpRegistrations =
    opts.check === true || !upgradesGrandMaester ? [] : await refreshMcpRegistrations(repoRoot);
  return { outcomes, counts: countOutcomes(outcomes), mcpRegistrations };
}

/**
 * Status rows. With `kinds`, every target of those kinds. Otherwise every
 * kind with at least one installed target — or, when nothing is installed,
 * the Grand Maester's targets, as before skill kinds existed.
 */
export async function runSkillStatus(
  repoRoot: string,
  opts: { kinds?: readonly SkillKind[] } = {},
): Promise<SkillStatusResult> {
  let kinds = opts.kinds;
  if (kinds === undefined) {
    const installed: SkillKind[] = [];
    for (const kind of SKILL_KINDS) {
      for (const target of listSkillTargets(kind)) {
        if ((await target.readInstalledVersion(repoRoot)) !== undefined) {
          installed.push(kind);
          break;
        }
      }
    }
    kinds = installed.length > 0 ? installed : ["grand-maester"];
  }
  const outcomes: SkillStatusOutcome[] = [];
  let upToDate = 0;
  let outdated = 0;
  let notInstalled = 0;
  for (const [kind, target] of kinds.flatMap((k) =>
    listSkillTargets(k).map((t) => [k, t] as const),
  )) {
    const installedVersion = await target.readInstalledVersion(repoRoot);
    let state: SkillStatusOutcome["state"];
    if (installedVersion === undefined) {
      state = "not-installed";
      notInstalled += 1;
    } else if (installedVersion === SKILL_VERSION) {
      state = "up-to-date";
      upToDate += 1;
    } else {
      state = "outdated";
      outdated += 1;
    }
    outcomes.push({
      kind,
      id: target.id,
      label: target.label,
      artifactPaths: target.artifactPaths,
      state,
      ...(installedVersion !== undefined ? { installedVersion } : {}),
      currentVersion: SKILL_VERSION,
    });
  }
  return {
    outcomes,
    counts: { upToDate, outdated, notInstalled },
  };
}

export { listSkillTargets } from "./targets/index.js";
export type {
  SkillKind,
  SkillInstallOutcome,
  SkillInstallResult,
  SkillStatusOutcome,
  SkillStatusResult,
  SkillTargetId,
} from "./types.js";

async function safeWrite(
  write: ReturnType<typeof getTarget>["write"],
  input: { repoRoot: string; skillVersion: string; citadelBaseDir: string },
): Promise<{ action: SkillInstallOutcome["action"]; installedVersion?: string; error?: string }> {
  try {
    return await write(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { action: "failed", error: message };
  }
}

async function findInstalledGroups(
  repoRoot: string,
  kinds: readonly SkillKind[],
): Promise<(ReturnType<typeof dedupeTargets>[number] & { kind: SkillKind })[]> {
  const groups = [];
  for (const kind of kinds) {
    const installed = [];
    for (const target of listSkillTargets(kind)) {
      if ((await target.readInstalledVersion(repoRoot)) !== undefined) installed.push(target);
    }
    groups.push(...dedupeTargets(installed).map((g) => ({ ...g, kind })));
  }
  return groups;
}

function countOutcomes(outcomes: readonly SkillInstallOutcome[]): SkillInstallResult["counts"] {
  let installed = 0;
  let upgraded = 0;
  let unchanged = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (o.action === "installed") installed += 1;
    else if (o.action === "upgraded") upgraded += 1;
    else if (o.action === "unchanged") unchanged += 1;
    else if (o.action === "failed") failed += 1;
  }
  return { installed, upgraded, unchanged, failed };
}
