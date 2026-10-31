import picomatch from "picomatch";

/**
 * Likely-sensitive paths (architecture §6.19, Gap 80). Matched by path only —
 * file contents are never read. Shared by the inventory and the change-set
 * guard so the two can never disagree.
 */
const SENSITIVE_RULES: readonly { patterns: string[]; reason: string; except?: string[] }[] = [
  {
    patterns: ["**/.env", "**/.env.*"],
    reason: "environment file",
    except: ["**/.env.example", "**/.env.sample", "**/.env.template"],
  },
  { patterns: ["**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx"], reason: "key material" },
  { patterns: ["**/*.kdbx"], reason: "password database" },
  {
    patterns: ["**/id_rsa*", "**/id_ecdsa*", "**/id_ed25519*"],
    reason: "SSH private key",
    except: ["**/*.pub"],
  },
  { patterns: ["**/.npmrc", "**/.pypirc", "**/.netrc"], reason: "credential store" },
  { patterns: ["**/.aws/**", "**/.ssh/**"], reason: "credential directory" },
  { patterns: ["**/secrets/**"], reason: "secrets directory" },
  { patterns: ["**/credentials*"], reason: "credentials file" },
  { patterns: ["**/*.tfstate", "**/*.tfstate.*"], reason: "Terraform state" },
];

const OPTIONS = { dot: true, nocase: true } as const;

const COMPILED = SENSITIVE_RULES.map((rule) => ({
  reason: rule.reason,
  match: picomatch(rule.patterns, OPTIONS),
  except: rule.except ? picomatch(rule.except, OPTIONS) : () => false,
}));

/** The reason a repo-relative path looks sensitive, or `undefined`. */
export function matchSensitive(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  for (const rule of COMPILED) {
    if (rule.match(normalized) && !rule.except(normalized)) return rule.reason;
  }
  return undefined;
}
