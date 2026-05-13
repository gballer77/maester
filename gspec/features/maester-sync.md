---
spec-version: v1
implementation-order: 4
---

# Maester Sync

## 1. Overview

**Feature name:** Maester Sync

**Summary:** A re-runnable script, installed into the citadel-bearing repository, that reads the citadel configuration, fetches each registered source (a remote git repository) at the configured ref using the configured authentication, and surfaces its content into the local `citadel/` directory (or a per-source override). Running maester-sync brings the local repository up to date with all of its declared knowledge sources in a single command. Each source is either **manifest-driven** (the remote repo publishes its own `maester.yaml` declaring what it makes available) or **includes-driven** (the citadel declares an `includes` list directly on the source). One sync command handles both modes.

**Problem being solved:** Once a citadel declares which remote repositories the project depends on, those repositories must actually be pulled in, kept up to date, and made available to humans and AI tools reading the working tree. Manually cloning, updating, and copying content from each remote is tedious, error-prone, and easy to forget. Maester Sync makes the citadel real — it transforms the declarative configuration into a working copy of the content, idempotently, across machines and across CI. The two source modes — manifest-driven (the remote owns the publish surface) and includes-driven (the citadel owns the filter set) — let one tool consume both repos that opt into the publish-surface contract and repos that do not.

## 2. Users & Use Cases

**Primary users:**
- Developers working in a repository that has a citadel and need its content available locally
- AI coding agents that need synced content present on disk to read it as context
- Continuous-integration jobs that prepare the working tree before downstream steps

**Key use cases:**
1. **Initial population on a fresh clone.** A developer clones a repo that has a citadel, runs maester-sync once, and the `citadel/` directory is populated with content from every declared source.
2. **Routine refresh.** A developer (or scheduled job) re-runs maester-sync to pick up new commits on each source at its configured ref. Unchanged sources are not re-copied unnecessarily; changed sources are updated in place.
3. **Selective refresh of one source.** A developer wants to refresh just one specific source by name without re-fetching the others.
4. **CI prerequisite step.** A CI pipeline runs maester-sync (with auth tokens supplied via environment variables) so that downstream lint, test, or build steps can read the surfaced citadel content.
5. **Failure-tolerant batch sync.** When several sources are configured and one is unreachable, the user can see clearly which succeeded and which failed without the whole run being lost.
6. **Pulling a third-party reference without owning the source repo.** A user wants a public reference repo's `docs/` directory available locally. The remote does not (and will not) publish a `maester.yaml`. The user adds it as a source with `includes: ["docs/**"]` — the citadel owns the filter set — and sync surfaces only those paths.

## 3. Scope

**In-scope:**
- A node-based script (scaffolded by [Citadel Initialization](citadel-initialization.md)) that performs the sync
- Reading and validating the citadel configuration file
- For each source: fetching the remote git repository at the configured ref using the configured authentication
- Copying the resolved content into the configured destination (default: `citadel/<source-name>/`)
- Two modes of path-filter resolution per source:
  - **Manifest-driven** (default): honor path filters defined by the **remote repo's own `maester.yaml`** (the source decides what it publishes; the citadel only chooses to consume it). Path-filter behavior itself is specified by a future feature; this feature commits to *respecting* whatever the remote publishes once that feature exists.
  - **Includes-driven**: when the citadel-side source entry declares a non-empty `includes` list, those paths/globs are authoritative and the remote `maester.yaml` is not consulted. Used for repos that do not publish a manifest.
- Idempotent re-runs: unchanged sources do not produce spurious file modifications
- Per-source status reporting (added / updated / unchanged / failed)
- Continuing past per-source failures and surfacing them in a final summary
- A way to scope a sync run to one or more named sources
- A non-zero exit code when one or more sources fail
- Resolving environment-variable references in the config to provide auth at runtime

**Out-of-scope:**
- Writing or editing the citadel configuration file (owned by Citadel Initialization)
- Defining how a remote repo declares which files it publishes (deferred separate feature)
- Bidirectional sync — maester-sync is read-only against remote sources
- Conflict resolution against user-edited files inside `citadel/`; the destination is treated as managed output
- Scheduling, daemonization, or file-system watching
- Network proxy configuration UX beyond what the underlying git binary already honors
- A long-running interactive UI; sync is a single-shot command

**Deferred ideas:**
- File-system watch mode that re-syncs on remote-side webhook triggers
- Caching layer that shares clones across multiple repos on the same machine
- Lockfile that pins each source to a resolved commit SHA for reproducible builds
- Output diffing / changelog summarization between syncs
- A "lint" capability that flags includes-driven sources whose `includes` have matched zero files for N successive syncs
- HTTP / website sources or cloud-drive sources (next likely non-git source kinds)

## 4. Capabilities

- [x] **P0**: Sync can be invoked from the repository root with a single command
  - The scaffolded entrypoint is runnable without arguments and performs a full sync of every configured source
  - Running outside a repository that has a citadel configuration exits with a clear error and non-zero status
  - The command produces human-readable output that names each source as it is processed

- [x] **P0**: Sync reads and validates the citadel configuration before doing any work
  - A missing config file produces a clear, actionable error referencing how to create one
  - A malformed config (invalid YAML / schema violation) produces a clear error pointing at the offending field
  - No remote operations occur until config validation has passed

- [x] **P0**: Sync fetches each source at its configured ref
  - Each source's remote git URL is fetched at the configured ref (branch, tag, or commit); when no ref is specified, the remote's default branch is used
  - Repeated runs update in place rather than re-cloning from scratch every time
  - The local fetch storage is treated as managed cache and is not expected to be committed

- [x] **P0**: Sync authenticates using environment-variable references resolved at runtime
  - For sources with `auth.type: "token"` and an env-var name, the value is read from that environment variable at execution time
  - A missing required environment variable causes that source to fail with a clear message naming the missing variable; other sources continue
  - No secret value is ever printed, logged, or written to disk by the sync output

- [x] **P0**: Sync surfaces each source's content into its destination directory
  - Default destination is `citadel/<source-name>/` at the repository root
  - A per-source `destination` override in the config is honored exactly
  - The destination directory's content for that source reflects the fetched remote content for that run (no stale leftover files from a previous sync of the same source)

- [x] **P0**: Sync is idempotent across repeated runs
  - Running sync twice in a row with no remote changes produces no file modifications on the second run (modification timestamps may change; content hashes do not)
  - When a source's remote ref has not advanced and its citadel-side filter set has not changed, the source is reported as "unchanged"
  - When a source's remote ref has advanced (or the citadel-side `includes` were edited), only the affected files in the destination are written

- [x] **P0**: Sync continues past per-source failures and reports them at the end
  - A failure to fetch, authenticate against, or copy one source does not abort the run for the remaining sources
  - A final summary lists each source with its outcome (added / updated / unchanged / failed) and an error message for each failure
  - Exit code is non-zero if and only if at least one source failed

- [x] **P0**: Sources with explicit `includes` use the citadel-side filter set directly
  - When a source declares a non-empty `includes` list in the citadel config, sync materializes exactly the paths/globs in that list and does not consult the remote's `maester.yaml`
  - The destination is populated with **only** the files matching the declared includes; anything outside the includes never appears in the destination
  - Editing the `includes` list and re-syncing reshapes the destination on the next run (the previous filter set is recorded in the provenance marker and the change is treated as drift)
  - An empty `includes` array is rejected at config-validation time

- [x] **P1**: User can scope a sync run to one or more named sources
  - The entrypoint accepts a list of source names and processes only those
  - An unknown name produces a clear error and non-zero exit before any work begins
  - All capabilities above apply identically to the scoped subset

- [x] **P1**: Sync honors path filters published by a source's own `maester.yaml` when no citadel-side `includes` is set
  - When a source has no `includes` in the citadel config and its remote repo includes a recognized `maester.yaml` self-description, the sync surfaces only the published subset
  - When `includes` is unset and no remote self-description exists (or it exists but fails schema validation), sync fails that source with a clear, actionable error and does not fall back to the full tree; other sources in the run continue
  - The error message points the user at the two ways forward: add a `maester.yaml` to the remote, or declare an `includes` list on the source in the citadel config
  - The exact schema of the remote self-description is owned by a future feature; this capability is met when sync respects whatever convention that feature defines

- [x] **P1**: Sync warns when an includes-driven source matches zero files at the resolved ref
  - The source is reported with a clear "no files matched includes" warning in the output
  - The warning does not by itself fail the source or the sync — the destination is left in a known-empty state and the run continues
  - The warning text references the source name and the includes list so the user can act on it

- [x] **P1**: Sources may carry optional human-readable metadata
  - Each source entry may include a short `description` and a list of short `tags`
  - Metadata is surfaced in sync output where helpful (e.g. alongside the source name in verbose mode) and is otherwise informational
  - Metadata fields are optional everywhere — entries without them remain valid

- [x] **P1**: Sync output is machine-readable when requested
  - A flag (e.g. `--json`) emits structured per-source results suitable for CI consumption
  - The default human-readable output remains the standard mode when no flag is passed

- [x] **P2**: Sync surfaces a stable provenance marker per source
  - Each source's destination directory contains a small metadata record indicating which remote URL, ref, and resolved commit SHA produced its current content, plus the filter set (manifest-resolved patterns or citadel-declared `includes`) active for that run
  - The marker is regenerated on every successful sync of that source
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
- Each source is a standard git repository accessible by URL + ref + optional token
- The user manages secret tokens through their shell, `.env` loader, or CI secret manager; sync only reads from `process.env`
- The remote-side "self-description" (`maester.yaml`) referenced by the manifest-driven mode is the responsibility of a future, separate feature and is not designed here
- When a source has explicit `includes`, the citadel owner accepts the upkeep cost: if the remote restructures its layout, the citadel's `includes` may need to be updated. The P1 zero-files-matched warning is the tripwire for that case.
- License and attribution obligations for third-party content surfaced by an includes-driven source are the citadel owner's responsibility; this feature does not enforce them.

**Risks:**
- **Secret token printed in error output.** A naive error path could include a remote URL with an embedded token or echo the token value. *Mitigation:* sync must never inline-embed tokens in URLs it logs, and must redact any env-var value before printing.
- **Partial copies on interruption.** Killing sync mid-copy could leave a destination in a torn state. *Mitigation:* writes per source should be staged and then promoted atomically (e.g. write-to-temp-then-rename) so an interrupted run leaves the previous destination intact.
- **Unbounded growth of the local cache.** Repeated syncs across many large sources could fill disk. *Mitigation:* the cache layout is per-source and replaceable; documented as managed and gitignored. A future capability may add a `prune` action.
- **Destination clobbering of unrelated files.** A misconfigured destination override could point at a path containing user-authored content. *Mitigation:* sync must refuse to write into a destination that contains content it did not previously produce, unless the destination is empty or contains its own provenance marker.
- **Strict manifest requirement surprises new users.** A manifest-driven source (no `includes`) pointed at a repo without a `maester.yaml` will fail rather than populate a directory. *Mitigation:* the error message names the source, explains why, and points the user at two concrete fixes (publish a manifest in the remote, or add an `includes` list to this source in the citadel config). Treating an unspecified publish surface as a configuration error — not a silent full-tree pull — is intentional: the manifest-driven mode exists precisely so the remote repo owns the publish contract.
- **Greedy includes silently surface huge trees.** A user writes `includes: ["**"]` and the destination explodes in size. *Mitigation:* `includes` is opt-in (the user must declare it explicitly) and a future "drift lint" capability can flag this.
- **Source-side restructuring breaks an includes list without breaking the sync.** An includes-driven source keeps running but stops surfacing the intended files. *Mitigation:* the zero-files-matched warning (P1) catches the most common case; the provenance marker (P2) makes it easy to spot when a known-good ref has produced unexpectedly empty content.

## 7. Success Metrics

- After a fresh `git clone` of a citadel-bearing repository, a single sync run produces a complete, working `citadel/` tree across every configured source
- Repeated syncs against unchanged remotes (and unchanged citadel-side `includes`) produce zero net content changes (verified by content-hash comparison)
- 100% of recorded auth secrets remain absent from sync stdout, stderr, and any written files
- A run with N configured sources where one fails still returns useful, complete results for the remaining N − 1 and a non-zero exit code
- A user can add a public third-party repo as an includes-driven source and, on first sync, have only the declared paths surfaced under `citadel/<source-name>/` — without modifying anything in the remote

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
