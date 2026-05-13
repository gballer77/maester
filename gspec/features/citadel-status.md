---
spec-version: v1
---

# Citadel Status

## 1. Overview

**Feature name:** Citadel Status

**Summary:** A read-only CLI command, invoked from a citadel-bearing repository, that reports whether each configured source is currently up to date with its remote or is behind and needs another sync. The command checks three signals per source — never-synced, remote ref advanced, and (for manifest-driven sources) remote publish surface changed — and reports a per-source verdict in human-readable and machine-readable forms. Both humans and AI agents are first-class callers.

**Problem being solved:** Today, a user (or an agent) in a citadel has no fast way to answer "is anything behind?" short of running a full sync. That makes routine checks expensive (every check re-materializes content), noisy (a sync changes the working tree even when only one source is stale), and unfriendly to agents that need a cheap, scriptable signal before deciding whether to act. A dedicated status command separates *checking* from *fetching* — agents can poll for staleness without writing anything to the working tree, and humans get a clear, actionable summary in one command.

## 2. Users & Use Cases

**Primary users:**
- Developers working in a citadel-bearing repository who want a quick "anything behind?" check before relying on its content
- AI coding agents that read citadel content as context and need to know whether to trigger a sync first
- Continuous-integration jobs that want to fail or gate downstream steps when the citadel is stale

**Key use cases:**
1. **Routine pre-flight check.** A developer opens the repo in the morning and runs `maester status` to see whether anything has changed upstream since the last sync. The output names each source as up to date or behind, with a one-line reason for each behind source.
2. **Agent pre-check before reading content.** An AI agent about to use the citadel as context first runs `maester status`, sees a non-zero exit code, and triggers a sync (or asks the user to) before proceeding.
3. **CI gate.** A CI job runs `maester status` and uses its exit code to decide whether to fail the build, run a sync as part of the job, or proceed unchanged.
4. **Spot-check one source.** A developer who just edited the citadel config for one specific source runs `maester status <source-name>` to verify just that source's state without paying the network cost of checking everything.
5. **First-time check on a fresh clone.** A developer clones a citadel-bearing repo for the first time and runs `maester status`. Every source is reported as "never synced" with a clear instruction to run sync. The check itself does not perform the sync.

## 3. Scope

**In-scope:**
- A node-based CLI command invokable from a citadel-bearing repository (sibling to the sync command, scaffolded by the same install flow)
- Reading and validating the citadel configuration before doing any work
- For each in-scope source, performing three checks:
  - **Never synced** — the source has no recorded provenance from a prior sync
  - **Remote ref advanced** — the configured ref now resolves to a newer commit than the one recorded in the source's provenance marker
  - **Manifest changed** (manifest-driven sources only) — the remote publish surface declared by the source's `maester.yaml` differs from what was active at the last sync
- Authenticating to private remotes using the same environment-variable references the sync command uses
- A per-source verdict in human-readable output: `up-to-date`, `behind`, or `failed`, with a short reason for each behind/failed source
- A `--json` flag that emits structured per-source results suitable for agent and CI consumption
- A behind-aware exit code: `0` when every checked source is up to date, `1` when at least one is behind, `2` when the status check itself failed before completion
- A way to scope a status run to one or more named sources
- Continuing past per-source failures and surfacing them in a final summary
- Strictly read-only operation against the working tree — status never writes destination files, provenance markers, or any other artifact under the citadel destination directories

**Out-of-scope:**
- Performing the sync itself — status only reports; it never materializes content
- Detecting citadel-side configuration drift (e.g. the user edited `includes` since the last sync) — this v1 status command reports only the three signals listed above
- A `--fix` / `--auto-sync` mode that runs sync as a follow-up
- A "what changed" diff between the last-synced commit and the new remote ref (file lists, summaries of upstream commits)
- Long-running watch mode, daemonization, or scheduled checks
- Offline / cache-only mode — status is inherently a network operation
- Writing or updating provenance markers; status reads them but never rewrites them
- Reachability checks beyond what the status command needs for its three signals (no general "is the remote healthy?" probe)

**Deferred ideas:**
- A `--changes` flag that, for behind sources, summarizes the upstream commits or file-list deltas
- An offline subset of checks (e.g. "the citadel `includes` list changed since the last sync") if a future iteration wants to surface citadel-side drift
- A cache layer that short-circuits identical checks run within a configurable TTL
- A status output mode that also reports per-file state breakdowns (canon vs draft) sourced from [Document State Tagging](document-state-tagging.md)
- A `--fix` flag that triggers sync for the behind sources detected in the same run

## 4. Capabilities

- [ ] **P0**: Status can be invoked from the repository root with a single command
  - The status entrypoint is runnable without arguments and checks every configured source
  - Running outside a citadel-bearing repository exits with a clear error and exit code `2`
  - The command produces human-readable output that names each source as it is checked
  - The command performs no writes to the citadel destination directories, no writes to provenance markers, and no writes to the local cache beyond what the network checks themselves require

- [ ] **P0**: Status reads and validates the citadel configuration before doing any work
  - A missing config file produces a clear, actionable error and exit code `2`, referencing how to create one
  - A malformed config (invalid YAML / schema violation) produces a clear error pointing at the offending field and exit code `2`
  - No network operations occur until config validation has passed

- [ ] **P0**: Status reports "never synced" for any configured source that has no recorded provenance
  - A source whose destination directory does not exist, or exists without a recognized provenance marker, is reported as `behind` with the reason `never-synced`
  - The "never synced" determination is made before any network call for that source; no auth or fetch is attempted
  - The recommended action shown to the user references running sync

- [ ] **P0**: Status reports "behind" when a source's configured ref now resolves to a newer commit than its recorded provenance
  - For each previously-synced source, status resolves the configured ref against the remote and compares the resolved commit SHA to the one recorded in the source's provenance marker
  - When the resolved SHA differs from the recorded SHA in the direction of "newer / different upstream", the source is reported as `behind` with the reason `remote-ref-advanced` and includes both the recorded SHA and the newly-resolved SHA in the per-source output
  - When the resolved SHA matches the recorded SHA, the source is reported as `up-to-date`
  - The comparison is read-only against the remote — no working copy is updated and no destination file is touched

- [ ] **P0**: For manifest-driven sources, status reports "behind" when the remote publish surface has changed
  - For sources whose effective filter set comes from the remote `maester.yaml` (i.e. no citadel-side `includes` is set), status compares the remote manifest's current publish surface to the filter set recorded in the source's provenance marker
  - When the publish surface has changed (entries added, removed, or modified in a way that would change the set of files materialized), the source is reported as `behind` with the reason `manifest-changed`
  - This signal is independent of and can co-occur with `remote-ref-advanced`; when both apply, both reasons are surfaced in the per-source output
  - Includes-driven sources are not subject to this check (their filter set is owned by the citadel, not the remote) and the manifest-changed check is skipped for them

- [ ] **P0**: Status authenticates using environment-variable references resolved at runtime
  - For sources with token auth, the token is read from the configured environment variable at execution time using the same resolution rules as sync
  - A missing required environment variable causes that source to be reported as `failed` with a clear message naming the missing variable; other sources continue to be checked
  - No secret value is ever printed, logged, or written to disk by status output

- [ ] **P0**: Status uses a behind-aware exit code
  - Exit code is `0` when every checked source is reported as `up-to-date`
  - Exit code is `1` when at least one checked source is reported as `behind`, and zero sources are reported as `failed`
  - Exit code is `2` when at least one checked source is reported as `failed`, or when the status check could not complete (e.g. missing/invalid config, the command was invoked outside a citadel)
  - When both `behind` and `failed` sources are present in the same run, exit code `2` takes precedence (the user should be made aware of the failure)
  - Exit-code semantics are documented in the CLI's help output so agents and CI scripts can rely on them

- [ ] **P0**: Status continues past per-source failures and reports them at the end
  - A failure to authenticate against, fetch from, or query one source does not abort the run for the remaining sources
  - A final summary lists every checked source with its verdict (`up-to-date`, `behind`, or `failed`) and an error message for each `failed` source
  - The summary reports a count of each verdict so a caller can see "N of M sources behind" at a glance

- [ ] **P0**: User can scope a status run to one or more named sources
  - The entrypoint accepts a list of source names and checks only those
  - An unknown name produces a clear error and exits with code `2` before any network work begins
  - Every capability above applies identically to the scoped subset, including the exit-code semantics (`0` if every scoped source is up to date, `1` if any is behind, `2` if any failed)

- [ ] **P1**: Status output is machine-readable when requested
  - A `--json` flag emits structured per-source results suitable for agent and CI consumption, including: source name, verdict (`up-to-date` / `behind` / `failed`), one or more reason codes for `behind` (`never-synced`, `remote-ref-advanced`, `manifest-changed`), an error message for `failed`, and where applicable the recorded and resolved commit SHAs
  - The default human-readable output remains the standard mode when `--json` is not passed
  - The structured output includes the same top-level counts (up-to-date / behind / failed) so an agent can branch on a single field
  - Exit-code semantics are identical in both output modes

- [ ] **P1**: Status output gives the user a clear next-step pointer
  - When at least one source is `behind`, the human-readable output names the sync command and (where applicable) suggests the specific scoped invocation that would refresh the behind sources
  - When every checked source is `up-to-date`, the output makes that explicit ("Nothing to sync.")
  - When at least one source is `failed`, the human-readable output points the user at the per-source error message
  - These hints appear only in the human-readable mode; structured output remains a clean data surface

- [ ] **P1**: Status reuses sync's network and auth machinery without re-implementing it
  - The remote-ref resolution and manifest fetch share whatever underlying git / network / auth code paths the sync command already uses, so a configuration that authenticates successfully under sync authenticates successfully under status
  - The local cache used by sync may be read by status, but status does not promote, populate, or invalidate it on a source's behalf — any reads must be free of side effects from the citadel's point of view
  - Network errors surface with the same shape and redaction guarantees as sync (no embedded tokens, no leaked env-var values)

- [ ] **P2**: Status output adapts when there are no sources configured
  - A citadel config with zero sources produces a clear, calm "no sources configured" message and exit code `0`
  - The empty-sources case is also represented faithfully in `--json` output (an empty per-source array and all counts at zero)

## 5. Dependencies

- **Maester Sync** ([maester-sync.md](maester-sync.md)) — Status reuses the configuration, provenance marker, network, and auth machinery established by sync. The provenance marker shape defined by sync's P2 capability is what status compares against; expanding or relocating that marker would also affect status.
- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Init scaffolds the citadel and its sync entrypoint; status is a sibling command installed by the same scaffolding pathway and consumes the same generated config.
- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — The remote `maester.yaml` produced by this feature is what the "manifest-changed" check inspects. Status's comparison must match whatever manifest shape Maester Configuration defines.
- **Pretty CLI** ([pretty-cli.md](pretty-cli.md)) — All human-readable status output renders through the shared CLI styling layer (theme tokens, TTY detection, `NO_COLOR`).

**External dependencies:**
- The `git` binary must be available on the host running status
- Network access to the configured remote git hosts at status time
- Environment variables holding the same auth tokens used by sync

## 6. Assumptions & Risks

**Assumptions:**
- A previously-successful sync has recorded a provenance marker per source; status uses that marker as its baseline for "what we last synced". Sources without a marker are correctly classified as `never-synced`.
- Status is inherently online — every check beyond `never-synced` requires a remote query. A future offline / cache-only mode is deferred.
- Status is read-only against the citadel destination directories and the local cache (no provenance rewrites, no destination materialization). Callers can rely on running status without it altering the working tree.
- Agents and CI scripts can rely on the documented exit-code contract (`0` / `1` / `2`) as a stable interface.
- The remote-ref resolution semantics (how a branch / tag / commit ref is resolved against the remote) match those of the sync command, so status's verdict cannot disagree with what an immediate sync would do.

**Risks:**
- **Network cost of checking many sources.** A citadel with many sources pays a network round-trip per source on every status invocation. *Mitigation:* status performs the cheapest viable check per source (ref resolution and, where needed, manifest fetch) — not a full clone — and the deferred cache layer can address pathological cases later.
- **Stale provenance after a partial sync.** If a previous sync failed mid-run, a source's provenance marker could be out of sync with what was actually materialized. *Mitigation:* sync's atomic-write capability (its existing risk mitigation) keeps the provenance marker consistent with the destination; status takes the marker at face value and will therefore be correct whenever sync was correct.
- **Reason-code drift between status and sync.** If sync evolves new failure modes (e.g. new auth schemes), status's reason vocabulary could lag. *Mitigation:* status reuses sync's network and auth code paths so the surface area where the two commands could diverge is small.
- **Manifest-change false positives.** Cosmetic edits to a remote `maester.yaml` (re-ordering entries, whitespace, comments) could be reported as `manifest-changed` even when the resolved publish surface is unchanged. *Mitigation:* the check compares the *resolved publish surface* (the set of patterns or files the manifest produces) rather than raw text, so cosmetic edits do not flip the verdict.
- **Agents over-polling.** A misconfigured agent could call status in a tight loop and exhaust rate limits on a hosted git provider. *Mitigation:* this is an operational concern, not a feature one; documenting status as a network operation in the CLI help mitigates accidental misuse. A future cache TTL is the longer-term answer.
- **Confusion when status disagrees with what a user expects.** A user who just edited `includes` may run status, see "up to date" (because v1 status does not detect citadel-side config drift), and be surprised. *Mitigation:* the deferred "citadel-side config drift" check is a known gap; the v1 status command's stated signal set is documented explicitly, and the human-readable output's "Nothing to sync." message can be revisited in a later iteration when that signal is added.

## 7. Success Metrics

- An AI agent in a citadel-bearing repo can determine in a single command (and a single exit-code branch) whether the citadel is up to date without touching the working tree.
- After a fresh clone, status reports every configured source as `behind` with reason `never-synced` and exits with code `1`.
- Across a representative citadel with N sources, the working-tree contents and provenance markers are byte-identical before and after a status run (verified by content-hash comparison).
- 100% of recorded auth secrets remain absent from status stdout, stderr, and any written files.
- A status run where one source fails to authenticate still returns correct verdicts for the remaining sources and exits with code `2`.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
