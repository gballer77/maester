export const FRESHNESS_AWARENESS = `## Freshness awareness

Citadel content can drift out of date if remote sources have advanced since
the last sync. Before reading citadel files to answer a question, check
freshness with:

\`\`\`
npx maester status
\`\`\`

Exit codes:

- **\`0\`** — every source is up to date. Proceed with reading.
- **\`1\`** — at least one source is **behind** (remote has advanced, or the
  remote manifest changed, or a source has never been synced). Surface the
  one-line verdict to the user and offer to run \`npx maester sync\` before
  continuing. The user may choose to read the (possibly stale) content
  anyway; do not block them.
- **\`2\`** — the status check itself failed (no citadel config, no network,
  auth missing). Surface the error and proceed with a caveat that staleness
  cannot be verified.

For machine-readable output, pass \`--json\` and parse the NDJSON stream
emitted on stdout. The final line contains \`{ "type": "summary", "upToDate":
N, "behind": N, "failed": N }\`.

**On Claude Code specifically**, a pre-read hook installed by
\`maester skill install\` runs this check automatically before any \`Read\`,
\`Glob\`, or \`Grep\` targeting a path under \`{{baseDir}}/\`. The hook
debounces (default 300s, override with \`MAESTER_SKILL_STATUS_TTL\`) so the
check does not run more than once per session for routine reads.
`;
