---
spec-version: v1
---

# Local Maesters

## 1. Overview

**Feature name:** Local Maesters

**Summary:** A second kind of citadel source, declared with a filesystem `path` instead of a git `url`, that surfaces a maester living on the local machine without cloning anything. By default the source is **linked** (the citadel destination holds per-file links that point at the originals, so edits are visible immediately and nothing is copied); an opt-in **copy** mode mirrors the content exactly like a remote source does.

**Problem being solved:** Every citadel source today is a remote git repository fetched over the network into a local cache. That is the wrong shape for knowledge that already lives on the developer's disk: a sibling checkout they are actively editing, a personal notes directory, a documentation tree that is not (or not yet) in git. Forcing those through clone-and-copy means stale content between syncs, duplicated bytes, and a network round-trip for something sitting next door. Local maesters let the citadel reach that content directly, with the same manifest contract, the same destination layout, and the same agent-facing surface as remote sources — so the Grand Maester skill and every downstream feature keep working unchanged.

## 2. Users & Use Cases

**Primary users:**
- Developers who keep several related repositories checked out side by side and want one of them to read the others' declared docs
- Individuals maintaining personal or team knowledge directories outside of git
- AI-assisted developers who want the citadel to reflect in-progress documentation edits without a sync-after-every-save loop

**Key use cases:**
1. **Sibling checkout as a source.** A developer has `../platform-docs` cloned beside their citadel repo. They add it as a `path` source. Sync links its published documents into the citadel destination; edits in `../platform-docs` are visible in the citadel immediately.
2. **Notes directory that is not a git repo.** A user keeps `~/docs/specs` with a `maester.yaml` at its root. They register it by path and the citadel surfaces exactly the documents the manifest publishes, with no git involved at any step.
3. **Includes-driven local directory.** A directory has no manifest. The user adds it with an `includes` list; the citadel owns the filter set, exactly as with includes-driven remote sources.
4. **Snapshot for sharing.** A team wants a committed, portable copy of a locally authored doc set. They set `mode: copy` on the path source; sync mirrors the content into the destination so it can be committed like any remote source's output.

## 3. Scope

**In-scope:**
- A `path` field on a citadel source entry, mutually exclusive with `url`
- Path resolution: repo-relative paths resolve against the citadel repository root; absolute paths are accepted; a leading `~` and `${ENV_VAR}` references are expanded at run time
- A per-source `mode` field with values `link` (default for path sources) and `copy`
- Manifest-driven and includes-driven resolution for path sources, identical in semantics to remote sources
- Link mode: one link per materialized file inside the destination, honoring the resolved filter set; the destination is added to the repository's ignore file automatically
- Copy mode: a byte-for-byte mirror of the resolved files into the destination, committable, with the same idempotency and provenance guarantees as remote sources
- A provenance marker for path sources recording the resolved source path, mode, filter set, and a content fingerprint
- Status verdicts for path sources (see capabilities)
- Rejecting `ref`, `auth`, and `mode` combinations that make no sense (e.g. `mode` on a `url` source, `auth` on a `path` source) at config-validation time
- Safety checks that prevent a path source from pointing inside the citadel's own output or recursing into itself
- The init walkthrough and the add-source wizard offering "local directory" alongside "git repository"
- Updating the installed Grand Maester instruction text to explain that linked sources reflect live local content

**Out-of-scope:**
- Finding candidate directories automatically — owned by [Maester Discovery](maester-discovery.md)
- Generating a catalog of what each source contains — owned by [Citadel Index](citadel-index.md)
- Watching the filesystem for changes
- Writing back to the source directory; the citadel never modifies a path source's files
- Rewriting inline metadata (state, category, tags) into linked files; link mode leaves originals untouched, so resolved metadata for linked files is surfaced through the citadel index rather than written inline

**Deferred ideas:**
- A machine-local override file (e.g. `citadel.local.yaml`, ignored by version control) that points an existing remote source at a local checkout for the duration of a development session
- Exposing linked documents through the MCP server for agent hosts that cannot follow links outside their workspace
- A directory-level link (one link for the whole source) as an alternative to per-file links

## 4. Capabilities

- [ ] **P0**: User can declare a citadel source by local path
  - The source schema accepts `path` as an alternative to `url`; exactly one of the two must be present, and a source with both or neither fails validation with a clear error naming the source
  - `path` accepts repo-relative and absolute forms; `~` and `${ENV_VAR}` are expanded at run time, and an unset referenced variable fails that source at run time with a message naming the variable (other sources continue)
  - `ref` and `auth` are rejected on a path source at validation time with a message explaining they apply only to git sources
  - `includes`, `destination`, `description`, and `tags` behave identically on path sources and url sources

- [ ] **P0**: Path sources resolve their filter set the same way remote sources do
  - When the source has no `includes`, the directory must contain a valid manifest at its root; sync surfaces exactly the manifest's published set
  - When the directory has no manifest (or an invalid one) and no `includes` is set, the source fails with the same actionable error used for remote sources, pointing at the two fixes
  - When `includes` is set, it is authoritative and the manifest is not consulted
  - An includes-driven path source that matches zero files is reported with the existing "no files matched" warning and does not fail the run

- [ ] **P0**: Link mode surfaces documents without copying them
  - When `mode` is `link` (the default for path sources), the destination contains one link per resolved file, preserving the file's relative path within the source
  - Each link resolves to the original file from the destination's location on the same machine
  - Files that fall outside the resolved filter set are never linked; a single whole-directory link is not used
  - Re-running sync against an unchanged source and filter set produces no modifications in the destination and reports the source as `unchanged`

- [ ] **P0**: Link-mode destinations are excluded from version control automatically
  - On the first successful sync of a link-mode source, the destination path is added to the repository's ignore file if not already covered
  - The ignore entry is scoped to that destination only; other sources' destinations are unaffected
  - The sync output names the ignore entry it wrote so the user understands why the directory is not committed

- [ ] **P0**: Copy mode mirrors a path source like a remote source
  - When `mode` is `copy`, the destination contains a byte-for-byte mirror of the resolved files and is safe to commit
  - Inline state, category, and tag resolution applies to copied files exactly as it does for remote sources
  - A second sync with no source changes produces no content modifications; a changed source file results in only the affected destination files being rewritten
  - Stale files from a previous sync of the same source are removed from the destination

- [ ] **P0**: Path sources carry a provenance marker
  - The marker records the resolved absolute source path, the mode, the active filter set, a content fingerprint of the resolved file set, and the sync timestamp
  - The marker is written on every successful sync of the source and is the basis for the `unchanged` verdict
  - The marker contains no secret values and, for copy mode, is safe to commit

- [ ] **P0**: Path sources are protected against self-reference and output overlap
  - A `path` that resolves inside the citadel's base directory, or inside any configured destination, is rejected at validation time with a message naming the overlap
  - A `destination` that resolves inside the source `path` is rejected the same way
  - A `path` that does not exist or is not a directory fails that source at run time with a clear message; other sources continue

- [ ] **P0**: Status reports meaningful verdicts for path sources
  - A path source that has never been synced is reported as `behind` with reason `never-synced`, as for remote sources
  - A copy-mode source whose current content fingerprint differs from the recorded one is `behind` with reason `local-changed`
  - A link-mode source whose source directory is missing, or any of whose links no longer resolve, is reported as `failed` with reason `source-missing`
  - A manifest-driven path source whose manifest publish surface has changed since the recorded filter set is `behind` with reason `manifest-changed`
  - Status performs no network operations for path sources, and the exit-code rules of the status feature apply unchanged

- [ ] **P1**: Init and the add-source wizard offer a local directory option
  - When registering a source, the user chooses between "git repository" and "local directory" before entering the location
  - Choosing local directory collects a path, validates that it exists and is a directory, and offers the `link` / `copy` choice with `link` pre-selected
  - A path with no manifest prompts for an `includes` list, mirroring the remote flow
  - The generated config entry round-trips through validation without edits

- [ ] **P1**: Installed Grand Maester artifacts explain linked sources
  - The citadel-awareness instruction text states that some sources may be linked rather than mirrored, that their content reflects the live local files, and that a dangling link means the source has moved
  - The text does not enumerate individual sources
  - The install is otherwise unchanged for citadels that have no path sources

- [ ] **P1**: Sync and status output distinguish path sources from remote sources
  - Human-readable output labels each path source with its mode (`linked` / `copied`) alongside its name
  - Structured (`--json`) output includes the source kind (`git` / `path`), the mode, and the resolved source path
  - No secret values appear in either output mode

- [ ] **P2**: Linked documents are reachable through the MCP server
  - When the citadel has at least one link-mode source, the MCP server exposes a tool to list that source's resolved documents and a tool to read one by its citadel-relative path
  - Reads return the current content of the original file
  - Tools are namespaced by source name, consistent with the existing connector tool-naming convention

## 5. Dependencies

- **Maester Sync** ([maester-sync.md](maester-sync.md)) — path sources are processed by the same sync run, share its per-source status model, scoped runs, idempotency contract, and failure tolerance.
- **Citadel Status** ([citadel-status.md](citadel-status.md)) — new reason codes `local-changed` and `source-missing` extend the status feature's verdict vocabulary; exit-code semantics are unchanged.
- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — a manifest-driven path source reads the manifest defined there.
- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) and **Config Editing** ([config-editing.md](config-editing.md)) — both source-registration flows gain the local-directory option.
- **Grand Maester Skill** ([grand-maester-skill.md](grand-maester-skill.md)) — instruction text is extended to describe linked sources.
- **Document State Tagging** ([document-state-tagging.md](document-state-tagging.md)) and **Document Category and Tags** ([document-category-and-tags.md](document-category-and-tags.md)) — inline rewriting applies to copy mode only; link mode relies on [Citadel Index](citadel-index.md) to surface resolved values.

**External dependencies:** The host filesystem must support file links in the citadel repository's location.

## 6. Assumptions & Risks

**Assumptions:**
- A path source is a trusted local directory; the citadel does not defend against a hostile source tree.
- Linked content is inherently machine-specific, so excluding link-mode destinations from version control is the correct default and does not need a toggle.
- Developers who need a committed, portable artifact from a local source will accept the explicit `mode: copy` opt-in.
- The agent host used by the developer can follow file links within the repository; where it cannot, the deferred MCP capability is the fallback.

**Risks:**
- **Links break silently when the source moves.** A renamed or deleted source directory leaves dangling links the agent may try to read. *Mitigation:* status reports `source-missing`, and the Grand Maester text tells the agent what a dangling link means.
- **A committed index references machine-local files.** Other developers' citadels will not have the linked files. *Mitigation:* owned by [Citadel Index](citadel-index.md), which separates machine-local entries from committable ones.
- **Recursive or overlapping paths.** A path pointing at the citadel's own output would loop or clobber. *Mitigation:* validation rejects any overlap between a source path and any destination, in both directions.
- **Environment-variable paths differ between machines.** A committed `${DOCS_HOME}/notes` works only where the variable is set. *Mitigation:* the run-time error names the variable; the config remains valid elsewhere and other sources continue.
- **Copy-mode drift between syncs.** Local edits land in the citadel only after a sync, which may surprise users expecting link behavior. *Mitigation:* status reports `local-changed`, and sync output labels the mode on every run.

## 7. Success Metrics

- A directory with a valid manifest can be added by path and surfaced into the citadel with zero network activity, verified by running sync with networking disabled.
- Editing a file in a link-mode source is visible through its citadel path without re-running sync, in 100% of cases where the file is within the resolved filter set.
- Repeated syncs of an unchanged path source produce zero destination modifications in both modes.
- Every misconfiguration this feature guards against (both `url` and `path`, `auth` on a path source, overlap with a destination, missing directory) produces an actionable error before or during the affected source's processing, never a partial or corrupted destination.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
