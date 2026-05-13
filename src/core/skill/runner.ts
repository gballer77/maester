import { dedupeTargets, getTarget, listSkillTargets } from "./targets/index.js";
import type {
  SkillInstallOutcome,
  SkillInstallResult,
  SkillStatusOutcome,
  SkillStatusResult,
  SkillTargetId,
} from "./types.js";
import { SKILL_VERSION } from "./version.js";

export type RunSkillInstallOpts = {
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
  // Validate every requested id before any write.
  const targets = opts.targets.map((id) => getTarget(id));
  const groups = dedupeTargets(targets);
  const outcomes: SkillInstallOutcome[] = [];
  for (const group of groups) {
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
  return { outcomes, counts: countOutcomes(outcomes) };
}

export type RunSkillUpgradeOpts = {
  check?: boolean;
  citadelBaseDir: string;
};

export async function runSkillUpgrade(
  repoRoot: string,
  opts: RunSkillUpgradeOpts,
): Promise<SkillInstallResult> {
  const installedGroups = await findInstalledGroups(repoRoot);
  if (installedGroups.length === 0) {
    return { outcomes: [], counts: countOutcomes([]) };
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
  return { outcomes, counts: countOutcomes(outcomes) };
}

export async function runSkillStatus(repoRoot: string): Promise<SkillStatusResult> {
  const outcomes: SkillStatusOutcome[] = [];
  let upToDate = 0;
  let outdated = 0;
  let notInstalled = 0;
  for (const target of listSkillTargets()) {
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

async function findInstalledGroups(repoRoot: string): Promise<ReturnType<typeof dedupeTargets>> {
  const targets = listSkillTargets();
  const installed = [];
  for (const target of targets) {
    const installedVersion = await target.readInstalledVersion(repoRoot);
    if (installedVersion !== undefined) installed.push(target);
  }
  return dedupeTargets(installed);
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
