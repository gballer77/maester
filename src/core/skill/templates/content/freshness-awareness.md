## Freshness awareness

Citadel content can drift out of date when remote sources advance after the
last sync. The Grand Maester is **auto-sync directed**: when the citadel is
behind, refresh it before reading rather than relying on stale content.

**Auto-sync policy**

When you discover that the citadel is behind — either from the Claude Code
pre-read hook's `additionalContext` message, or from a manual run of
`npx baller-maester status` — follow these steps without prompting the user:

1. Run `npx baller-maester sync` to refresh every configured source.
   - Exits 0 on success.
   - Exits non-zero if any source failed (missing auth env var, ref typo,
     network error). Report the failure to the user and proceed cautiously.
2. **Invalidate the pre-read hook's debounce cache** so the next read
   observes fresh state instead of the stale verdict captured before the
   sync:
   ```
   rm -f .maester/.skill-cache.json
   ```
3. Proceed with the original read of the citadel file.

You do not need to ask the user before syncing. `maester sync` is read-only
against the remote sources it pulls from; it only materializes content the
`citadel.yaml` already declared. The same sync the user would run manually.

**Don't loop on failures.** If `maester sync` fails (or the hook reports a
`failed` verdict from `maester status`), do **not** retry sync repeatedly.
Surface the failure to the user, proceed with the read, and flag that cited
content may be stale.

**Avoid redundant syncs within a session.** Once you have synced and
invalidated the cache, ignore any further "citadel is behind" messages that
arrive before you have done another citadel read — they are cached signals
captured before your sync completed.

**Manual status check**

```
npx baller-maester status
```

Exit codes:

- **`0`** — every source is up to date.
- **`1`** — at least one source is behind (remote advanced, manifest
  changed, or never-synced). Run the auto-sync policy above.
- **`2`** — the status check itself failed. Surface to the user; proceed
  with a caveat that staleness cannot be verified.

For machine-readable output, pass `--json` and parse the NDJSON stream on
stdout. The final line contains `{ "type": "summary", "upToDate": N,
"behind": N, "failed": N }`.

**On Claude Code specifically**, a `PreToolUse` hook installed by
`maester skill install` runs the status check automatically before any
`Read`, `Glob`, or `Grep` targeting a path under `{{baseDir}}/`. The
hook debounces (default 300s, override with `MAESTER_SKILL_STATUS_TTL`) so
the check does not run more than once per session for routine reads.
