---
spec-version: v1
---

# Git Submodule Sources

## 1. Overview

**Feature name:** Git Submodule Sources

**Summary:** A single citadel source, and a single maester manifest, can cover content that lives inside the repository's git submodules. Sync fetches the submodules a source actually needs, and manifest documents and citadel `includes` can name paths inside submodules as if they were ordinary directories.

**Problem being solved:** Repositories that compose their content from git submodules lose that content in a citadel today. Sync fetches each source without its submodules, so every submodule path arrives as an empty directory. The only workaround is to register each submodule as its own source, or publish a separate manifest from each submodule repo. That multiplies config, splits one logical knowledge set across many citadel destinations, and drifts whenever the parent repo adds, removes or re-pins a submodule. Users expect one config to describe one repository tree, submodules included.

## 2. Users & Use Cases

**Primary users:**
- Maintainers of "umbrella" repositories that assemble docs, specs or services from several submodules
- Citadel owners who consume such repositories and want one source per logical repo, not one per submodule
- AI agents that read the citadel and need the submodule content present on disk

**Key use cases:**
1. **Umbrella repo with a manifest.** A platform repo vendors `services/billing` and `services/auth` as submodules. Its single `maester.yaml` publishes `docs/**` plus `services/*/docs/**`. A citadel that adds the platform repo as one source gets all three doc sets under one destination.
2. **Includes-driven third-party repo with submodules.** A citadel owner adds a public repo they don't control and declares `includes: ["docs/**", "vendor/spec/**"]`, where `vendor/spec` is a submodule. Sync fetches that submodule and surfaces its files. Other submodules are left alone.
3. **Whole-repository source.** A repo with no manifest and no `includes` resolves to whole-repository mode. Its submodules' files are surfaced along with the parent's, minus excludes.
4. **Re-pinned submodule.** The parent repo bumps a submodule to a newer commit. The next sync detects the change and updates the surfaced content, even though no file in the parent repo itself changed.

## 3. Scope

**In-scope:**
- Fetching submodules during sync for remote git sources, including nested submodules at any depth
- Fetching **only** the submodules that the source's resolved filter set reaches into (manifest documents, citadel `includes`, or whole-repository mode)
- A per-source opt-out (`submodules: false`) on citadel sources
- Treating paths inside submodules as ordinary paths in manifest `documents` entries, citadel `includes`, and `excludes`
- Applying the parent's filter set to submodule content. **The parent governs:** a submodule's own `maester.yaml` is ignored.
- Reusing the parent source's credentials for submodules hosted on the same host
- Per-submodule failure tolerance: an unreachable submodule produces a warning naming its path. The rest of the source still syncs.
- Change detection that reacts to a submodule being re-pinned, added or removed
- Local `path` sources: content inside already-initialized submodules is surfaced like any other files. Uninitialized submodules are reported, not fetched.
- Publisher-side tooling (`publish inventory`, `publish preview`, path validation) treats submodule paths as valid publish targets

**Out-of-scope:**
- Composing or merging a submodule's own `maester.yaml` into the parent's publish surface
- Initializing or updating submodules inside a local `path` source's working tree (maester never mutates a local checkout)
- Per-submodule credentials, or credentials for submodules on a different host than the parent source
- Tracking a submodule's branch tip. Sync always uses the commit the parent repo pins.
- Other ways of nesting repositories (subtrees, vendored copies, monorepo tools). Those are already plain files.

**Deferred ideas:**
- Opt-in delegation of a submodule subtree to that submodule's own `maester.yaml`
- Per-submodule auth overrides for cross-host submodules
- A per-source allow/deny list of submodule paths, beyond the on/off switch

## 4. Capabilities

- [x] **P0**: Sync fetches the submodules a remote source's filter set reaches into
  - A manifest document or `includes` glob that matches a path inside a submodule → that submodule is fetched at the commit the parent pins, and its matching files are surfaced in the source's destination at their parent-relative paths
  - Submodules no filter reaches into are not fetched
  - A repository with no submodules syncs exactly as before. Output, timing and on-disk results are unchanged.
- [x] **P0**: Nested submodules are followed at any depth
  - A filter that reaches a path inside a submodule of a submodule → both levels are fetched and the files surfaced
  - Cyclic or repeated submodule references don't cause unbounded fetching
- [x] **P0**: The parent's filter set governs submodule content
  - A submodule containing its own `maester.yaml` → that file is ignored for publish decisions. Only the parent manifest or citadel `includes` decide.
  - `excludes`, and the built-in default excludes, apply to files inside submodules exactly as to parent files
- [x] **P0**: Whole-repository sources include submodule content
  - A whole-repository source with submodules → every submodule (recursively) is fetched and its files surfaced, minus excludes
  - Submodule content is linked, not copied, just like the rest of a whole-repository source
- [x] **P0**: An unreachable submodule degrades to a warning, not a source failure
  - Submodule fetch fails (auth, missing commit, network) → the source still syncs everything else and reports a warning naming the submodule path and the reason
  - The run's exit code reflects the warning in the same way as other per-source warnings, not as a source failure
  - The warning appears in the final summary so it isn't lost in scrollback
- [x] **P0**: Submodules on the same host reuse the parent source's credentials
  - Private submodule on the same host as the parent, with parent auth configured → fetched successfully with no extra config
  - A submodule on a different host is attempted without the parent's credentials. Those credentials are never sent to another host.
- [x] **P1**: A citadel source can opt out with `submodules: false`
  - `submodules: false` → no submodule is fetched; submodule paths stay empty, and sync notes that matching paths were skipped because submodules are disabled
  - The field is optional, defaults to enabled, and is accepted by config validation and the config JSON schema
  - `maester list` / `maester list --json` shows the setting when it is not the default
- [x] **P1**: Change detection reacts to submodule changes
  - Parent re-pins a submodule to a new commit → next sync reports the source as updated and refreshes the affected files
  - Submodule added or removed in the parent → surfaced content is added or removed accordingly
  - No parent or submodule change → source reports unchanged and no files are rewritten
- [x] **P1**: Local `path` sources surface initialized submodule content and report uninitialized submodules
  - A filter reaches into an initialized submodule in a local source → its files are surfaced (linked or copied per the source's mode)
  - A filter reaches into an uninitialized submodule → a warning names the path and suggests initializing it. Maester does not change the local checkout.
- [x] **P1**: Publisher tooling treats submodule paths as first-class
  - `publish inventory` lists candidate documents inside initialized submodules and marks which submodule each belongs to
  - `publish preview` and `publish apply` / `add` path validation accept paths inside submodules without "path does not resolve" warnings when the submodule is initialized
  - A path inside an uninitialized submodule produces a specific warning ("inside submodule `<path>`, not initialized") instead of the generic missing-path warning
- [ ] **P2**: Status and sync output show submodule provenance
  - Sync output for a source that pulled submodules lists how many submodules were fetched, plus any that were skipped
  - `maester status` reports the pinned commit of each fetched submodule alongside the source's own commit

## 5. Dependencies

- [Maester Sync](maester-sync.md): fetch, filter, staging and change detection are extended, not replaced
- [Maester Configuration](maester-configuration.md): manifest `documents` paths may point inside submodules
- [Whole-Repository Sources](whole-repository-sources.md): whole-repository mode includes submodule content, still linked
- [Local Maesters](local-maesters.md): path sources surface initialized submodules
- [AI-Aided Maester Definition](ai-aided-maester-definition.md): inventory, preview and apply understand submodule paths
- [Config JSON Schemas](config-json-schemas.md): the new optional `submodules` source field
- [Citadel Status](citadel-status.md): submodule provenance (P2)
- External: the system git binary's submodule support

## 6. Assumptions & Risks

**Assumptions:**
- Submodule URLs in a source's submodule config are reachable from the machine running sync, either anonymously or with the parent's credentials when on the same host
- Relative submodule URLs resolve against the parent source's URL, matching standard git behavior
- Users want the content of the commit the parent pins, not the submodule's latest branch tip

**Risks & mitigations:**
- **Large or many submodules slow sync.** Mitigated by fetching only submodules the filter set reaches, using the same shallow, minimal-content fetch strategy as parent sources, and the `submodules: false` opt-out.
- **Credential leakage to third-party hosts.** Mitigated by reusing credentials only for submodules on the same host as the parent, and never injecting them into URLs for other hosts.
- **Deciding "does this filter reach into a submodule" for globs.** A glob like `**/*.md` reaches every submodule. That is the correct, expected behavior, but it can fetch more than the user expected. Mitigated by the per-source fetched-submodule count in sync output and the opt-out.
- **Pinned commit not fetchable with a shallow fetch** (e.g. not on any advertised branch). Mitigated by falling back to a deeper fetch of that one commit before degrading to the unreachable-submodule warning.

## 7. Success Metrics

- A repository whose docs span N submodules is fully represented in a citadel with **one** source entry and **one** manifest. Zero per-submodule sources are needed.
- Sync time and output for sources without submodules are unchanged
- Re-pinning a submodule in the parent is reflected by the next sync in 100% of cases, with no manual cache clearing
- An unreachable submodule never causes the rest of its source's content to be dropped

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
