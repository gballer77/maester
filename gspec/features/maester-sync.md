---
spec-version: v1
implementation-order: 4
---

# Maester Sync

## 1. Overview

**Feature name:** Maester Sync

**Summary:** A re-runnable script, installed into the citadel-bearing repository, that reads the citadel configuration, fetches each registered maester (a remote git repository) at the configured ref using the configured authentication, and surfaces its content into the local `citadel/` directory (or a per-maester override). Running maester-sync brings the local repository up to date with all of its declared knowledge sources in a single command.

**Problem being solved:** Once a citadel declares which remote repositories the project depends on, those repositories must actually be pulled in, kept up to date, and made available to humans and AI tools reading the working tree. Manually cloning, updating, and copying content from each remote is tedious, error-prone, and easy to forget. Maester Sync makes the citadel real — it transforms the declarative configuration into a working copy of the content, idempotently, across machines and across CI.

## 2. Users & Use Cases

**Primary users:**
- Developers working in a repository that has a citadel and need its content available locally
- AI coding agents that need maester content present on disk to read it as context
- Continuous-integration jobs that prepare the working tree before downstream steps

**Key use cases:**
1. **Initial population on a fresh clone.** A developer clones a repo that has a citadel, runs maester-sync once, and the `citadel/` directory is populated with all declared maester content.
2. **Routine refresh.** A developer (or scheduled job) re-runs maester-sync to pick up new commits on each maester at its configured ref. Unchanged maesters are not re-copied unnecessarily; changed maesters are updated in place.
3. **Selective refresh of one maester.** A developer wants to refresh just one specific maester by name without re-fetching the others.
4. **CI prerequisite step.** A CI pipeline runs maester-sync (with auth tokens supplied via environment variables) so that downstream lint, test, or build steps can read the surfaced citadel content.
5. **Failure-tolerant batch sync.** When several maesters are configured and one is unreachable, the user can see clearly which succeeded and which failed without the whole run being lost.

## 3. Scope

**In-scope:**
- A node-based script (scaffolded by [Citadel Initialization](citadel-initialization.md)) that performs the sync
- Reading and validating the citadel configuration file
- For each maester: fetching the remote git repository at the configured ref using the configured authentication
- Copying the resolved content into the configured destination (default: `citadel/<maester-name>/`)
- Honoring path filters defined by the **maester's own configuration in its remote repository** (the maester decides what it publishes; the citadel only chooses to consume it). Path-filter behavior itself is specified by a future feature; this feature commits to *respecting* whatever the maester publishes once that feature exists.
- Idempotent re-runs: unchanged maesters do not produce spurious file modifications
- Per-maester status reporting (added / updated / unchanged / failed)
- Continuing past per-maester failures and surfacing them in a final summary
- A way to scope a sync run to one or more named maesters
- A non-zero exit code when one or more maesters fail
- Resolving environment-variable references in the config to provide auth at runtime

**Out-of-scope:**
- Writing or editing the citadel configuration file (owned by Citadel Initialization)
- Defining how a maester declares which files it publishes (deferred separate feature)
- Bidirectional sync — maester-sync is read-only against remote maesters
- Conflict resolution against user-edited files inside `citadel/`; the destination is treated as managed output
- Scheduling, daemonization, or file-system watching
- Network proxy configuration UX beyond what the underlying git binary already honors
- A long-running interactive UI; sync is a single-shot command

**Deferred ideas:**
- File-system watch mode that re-syncs on remote-side webhook triggers
- Caching layer that shares clones across multiple repos on the same machine
- Lockfile that pins each maester to a resolved commit SHA for reproducible builds
- Output diffing / changelog summarization between syncs

## 4. Capabilities

- [ ] **P0**: Sync can be invoked from the repository root with a single command
  - The scaffolded entrypoint is runnable without arguments and performs a full sync of all configured maesters
  - Running outside a repository that has a citadel configuration exits with a clear error and non-zero status
  - The command produces human-readable output that names each maester as it is processed

- [ ] **P0**: Sync reads and validates the citadel configuration before doing any work
  - A missing config file produces a clear, actionable error referencing how to create one
  - A malformed config (invalid YAML / schema violation) produces a clear error pointing at the offending field
  - No remote operations occur until config validation has passed

- [ ] **P0**: Sync fetches each maester at its configured ref
  - Each maester's remote git URL is fetched at the configured ref (branch, tag, or commit); when no ref is specified, the remote's default branch is used
  - Repeated runs update in place rather than re-cloning from scratch every time
  - The local fetch storage is treated as managed cache and is not expected to be committed

- [ ] **P0**: Sync authenticates using environment-variable references resolved at runtime
  - For maesters with `auth.type: "token"` and an env-var name, the value is read from that environment variable at execution time
  - A missing required environment variable causes that maester to fail with a clear message naming the missing variable; other maesters continue
  - No secret value is ever printed, logged, or written to disk by the sync output

- [ ] **P0**: Sync surfaces each maester's content into its destination directory
  - Default destination is `citadel/<maester-name>/` at the repository root
  - A per-maester `destination` override in the config is honored exactly
  - The destination directory's content for that maester reflects the fetched remote content for that run (no stale leftover files from a previous sync of the same maester)

- [ ] **P0**: Sync is idempotent across repeated runs
  - Running sync twice in a row with no remote changes produces no file modifications on the second run (modification timestamps may change; content hashes do not)
  - When a maester's remote ref has not advanced, the maester is reported as "unchanged"
  - When a maester's remote ref has advanced, only the affected files in the destination are written

- [ ] **P0**: Sync continues past per-maester failures and reports them at the end
  - A failure to fetch, authenticate against, or copy one maester does not abort the run for the remaining maesters
  - A final summary lists each maester with its outcome (added / updated / unchanged / failed) and an error message for each failure
  - Exit code is non-zero if and only if at least one maester failed

- [ ] **P1**: User can scope a sync run to one or more named maesters
  - The entrypoint accepts a list of maester names and processes only those
  - An unknown name produces a clear error and non-zero exit before any work begins
  - All capabilities above apply identically to the scoped subset

- [ ] **P1**: Sync honors path filters published by each maester's own configuration in the remote repo
  - When the maester's remote repo includes a recognized self-description that limits what it publishes, the sync surfaces only the published subset
  - When no such self-description exists, the sync surfaces the maester's full tree at the configured ref (current default behavior)
  - The exact schema of that self-description is owned by a future feature; this capability is met when the sync respects whatever convention that feature defines

- [ ] **P1**: Sync output is machine-readable when requested
  - A flag (e.g. `--json`) emits structured per-maester results suitable for CI consumption
  - The default human-readable output remains the standard mode when no flag is passed

- [ ] **P2**: Sync surfaces a stable provenance marker per maester
  - Each maester's destination directory contains a small metadata record indicating which remote URL, ref, and commit SHA produced its current content
  - The marker is regenerated on every successful sync of that maester
  - The marker is human-readable and small enough to be safe to commit

## 5. Dependencies

- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Maester Sync consumes the configuration produced by init and is installed/scaffolded by it.

**External dependencies:**
- The `git` binary must be available on the host running the sync (network access plus authentication is required for private maesters)
- Network access to the configured remote git hosts at sync time

## 6. Assumptions & Risks

**Assumptions:**
- The citadel configuration is a trusted, repo-committed file; sync does not need to defend against an attacker-controlled config
- The destination directory (`citadel/<name>/` by default) is owned by sync and should not be hand-edited by users; any local edits there are overwritten by the next sync
- Each maester is a standard git repository accessible by URL + ref + optional token
- The user manages secret tokens through their shell, `.env` loader, or CI secret manager; sync only reads from `process.env`
- The maester's "self-description" of what it publishes (referenced in P1) is the responsibility of a future, separate feature and is not designed here

**Risks:**
- **Secret token printed in error output.** A naive error path could include a remote URL with an embedded token or echo the token value. *Mitigation:* sync must never inline-embed tokens in URLs it logs, and must redact any env-var value before printing.
- **Partial copies on interruption.** Killing sync mid-copy could leave a destination in a torn state. *Mitigation:* writes per maester should be staged and then promoted atomically (e.g. write-to-temp-then-rename) so an interrupted run leaves the previous destination intact.
- **Unbounded growth of the local cache.** Repeated syncs across many large maesters could fill disk. *Mitigation:* the cache layout is per-maester and replaceable; documented as managed and gitignored. A future capability may add a `prune` action.
- **Destination clobbering of unrelated files.** A misconfigured destination override could point at a path containing user-authored content. *Mitigation:* sync must refuse to write into a destination that contains content it did not previously produce, unless the destination is empty or contains its own provenance marker.
- **Forward-compatibility with the deferred maester-side filter feature.** Sync must respect a filter convention that does not yet exist. *Mitigation:* until that feature lands, sync uses the entire tree as the published subset, and the contract for honoring published filters is added without breaking the default behavior.

## 7. Success Metrics

- After a fresh `git clone` of a citadel-bearing repository, a single sync run produces a complete, working `citadel/` tree across all configured maesters
- Repeated syncs against unchanged remotes produce zero net content changes (verified by content-hash comparison)
- 100% of recorded auth secrets remain absent from sync stdout, stderr, and any written files
- A run with N configured maesters where one fails still returns useful, complete results for the remaining N − 1 and a non-zero exit code

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
