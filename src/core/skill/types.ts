export type SkillTargetId = "claude-code" | "codex" | "cursor" | "agents-md";

export type SkillAction = "installed" | "upgraded" | "unchanged" | "failed";

export type SkillInstallOutcome = {
  id: SkillTargetId;
  label: string;
  artifactPaths: readonly string[];
  action: SkillAction;
  installedVersion?: string;
  error?: string;
};

export type SkillInstallResult = {
  outcomes: SkillInstallOutcome[];
  counts: {
    installed: number;
    upgraded: number;
    unchanged: number;
    failed: number;
  };
};

export type SkillStatusOutcomeState = "up-to-date" | "outdated" | "not-installed";

export type SkillStatusOutcome = {
  id: SkillTargetId;
  label: string;
  artifactPaths: readonly string[];
  state: SkillStatusOutcomeState;
  installedVersion?: string;
  currentVersion: string;
};

export type SkillStatusResult = {
  outcomes: SkillStatusOutcome[];
  counts: {
    upToDate: number;
    outdated: number;
    notInstalled: number;
  };
};

export type SkillWriteInput = {
  repoRoot: string;
  skillVersion: string;
  citadelBaseDir: string;
};

export type SkillWriteOutcome = {
  action: SkillAction;
  installedVersion?: string;
  error?: string;
};

export type SkillTarget = {
  readonly id: SkillTargetId;
  readonly label: string;
  /** Repo-relative paths this target writes. */
  readonly artifactPaths: readonly string[];
  /** Writers backing different ids may share an implementation; ids with distinct writerKeys produce separate file artifacts. */
  readonly writerKey: string;
  write(input: SkillWriteInput): Promise<SkillWriteOutcome>;
  /** Read the installed version marker from disk, if any. */
  readInstalledVersion(repoRoot: string): Promise<string | undefined>;
};
