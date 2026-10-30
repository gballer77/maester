---
spec-version: v1
---

# Whole-Repository Sources

## 1. Overview

**Feature name:** Whole-Repository Sources

**Summary:** When neither the citadel nor the remote maester declares which documents to publish, [Maester Sync](maester-sync.md) consumes the entire remote repository (minus a built-in exclude list) instead of failing. This adds a third sync mode — **whole-repository** — alongside the existing includes-driven and manifest-driven modes. Whole-repository content is always **linked, never copied**: the destination holds per-file links into the local fetched copy of the repository and is excluded from version control, so an undeclared publish surface can never end up committed into the citadel.

**Problem being solved:** Today a source with no citadel-side `includes`, pointed at a repo with no `maester.yaml`, fails sync by design. A `maester.yaml` must also declare at least one entry. That forces users to enumerate document locations even when they simply want "everything in that repo" — common for small doc-only repos, spec repos, and knowledge bases where the whole tree *is* the content. Requiring paths up front adds friction and makes the first sync of a new source fail for a reason the user didn't care about.

**Mode resolution (in precedence order):**
1. Citadel source declares a non-empty `includes` → **includes-driven** (unchanged)
2. Remote has a `maester.yaml` with one or more published entries → **manifest-driven** (unchanged)
3. Remote has a `maester.yaml` with no published entries → **whole-repository**
4. Remote has no `maester.yaml` → **whole-repository** (previously an error)

## 2. Users & Use Cases

**Primary users:**
- Citadel maintainers adding remote repositories as knowledge sources
- Repository owners who want to publish their entire repo without listing paths

**Key use cases:**
1. **Doc-only repo, zero config.** A maintainer adds a team's handbook repo to the citadel, skips `includes`, and the first sync pulls the whole handbook.
2. **Third-party repo with no manifest.** A citadel consumes a repo the team doesn't own and can't add a `maester.yaml` to; sync pulls the whole tree rather than erroring.
3. **"Publish everything" maester.** A repo owner configures their repo as a maester but declares no specific entries, signalling that the whole repository is published.
4. **Trimming noise.** A whole-repo source pulls in a directory the citadel doesn't want; the maintainer adds an `excludes` pattern to that source rather than switching to a full `includes` list.

## 3. Scope

**In-scope:**
- New whole-repository sync mode, selected automatically per the resolution order above
- Link-only materialization in whole-repository mode: per-file links into the locally fetched repository, with the destination added to the repository's ignore file
- A built-in default exclude list applied in whole-repository mode
- An optional citadel-side `excludes` list on a source, applied in whole-repository mode
- Clear sync output identifying any source synced in whole-repository mode
- Recording the resolved mode in each source's sync metadata record
- Allowing a maester manifest with zero published entries (meaning "publish the whole repository")
- Updated citadel init wording explaining what skipping `includes` now means

**Out-of-scope:**
- Changing includes-driven or manifest-driven behavior when paths *are* declared
- An explicit "whole repo" flag or config value — whole-repository mode is inferred from the absence of paths
- Size limits, quotas, or file-count caps on whole-repository pulls
- Applying citadel-side `excludes` to includes-driven or manifest-driven sources
- Content transformation or filtering by file contents
- Copying whole-repository content into the destination; a committed snapshot requires declaring paths (`includes` or a published manifest)
- Writing inline metadata (state, category, tags) into whole-repository files; linked files carry only the metadata already present in the original

**Deferred ideas:**
- Maester-side `excludes` in `maester.yaml` so a "publish everything" repo can withhold specific paths
- Repo-level default metadata (state, category, tags) on an entry-less `maester.yaml`
- A warning threshold when a whole-repository pull exceeds a configurable file count or size
- Honoring the remote repository's own ignore rules as additional excludes

## 4. Capabilities

- [x] **P0**: Sync resolves each source's mode using the defined precedence
  - Non-empty citadel `includes` → includes-driven, regardless of remote manifest
  - Remote `maester.yaml` with ≥1 published entry and no citadel `includes` → manifest-driven
  - Remote `maester.yaml` with zero published entries and no citadel `includes` → whole-repository
  - No remote `maester.yaml` and no citadel `includes` → whole-repository (no longer an error)

- [x] **P0**: Whole-repository mode surfaces every file in the remote repo at the configured ref, minus excludes
  - Every file at the resolved commit appears in the source's destination as a link to the locally fetched copy, preserving relative paths
  - Files matching the built-in exclude list or the source's `excludes` are not linked
  - Re-running sync is idempotent: unchanged remote content produces no destination changes
  - Files deleted or newly excluded upstream are removed from the destination on the next sync, consistent with other modes

- [x] **P0**: Whole-repository content is linked, never copied
  - The destination is added to the repository's ignore file on the first whole-repository sync if not already covered, and the sync output names the entry it wrote
  - A source that explicitly requests copy materialization and resolves to whole-repository mode fails with a message explaining how to get a committable copy (declare `includes` or publish manifest entries); other sources continue
  - If the locally fetched copy is removed, status reports the source as needing a sync rather than silently serving dangling links

- [x] **P0**: A built-in default exclude list applies in whole-repository mode
  - VCS metadata directories are always excluded
  - Common dependency/vendor directories and build output directories are excluded by default
  - Binary and very large files are excluded by default
  - The built-in list is documented in user-facing help so users know what is skipped

- [x] **P0**: Sync output clearly flags whole-repository sources
  - Each source synced in whole-repository mode is labelled as such in the per-source result line
  - The label states *why* (no `includes` and no manifest, or manifest with no entries)
  - The message points to how to narrow the pull (add `includes`, add `excludes`, or publish entries in the remote `maester.yaml`)

- [x] **P0**: Sync metadata records the resolved mode
  - Each source's metadata record includes the mode (`includes`, `manifest`, or `whole-repository`)
  - In whole-repository mode, the record lists the effective exclude patterns (built-in + source `excludes`)

- [x] **P1**: A citadel source can declare an optional `excludes` list
  - `excludes` accepts repo-relative paths and globs, validated with the same shape rules as `includes`
  - In whole-repository mode, matching files are skipped in addition to the built-in list
  - When the source is includes-driven or manifest-driven, a non-empty `excludes` produces a warning that it was ignored, and sync continues

- [x] **P1**: Maester configuration allows a manifest with zero published entries
  - The maester walkthrough lets the user finish without adding entries, after an explicit confirmation that this publishes the whole repository
  - The resulting manifest is valid and consumable by sync, which treats it as whole-repository
  - Final output states that the whole repository is published

- [x] **P1**: Citadel init explains the fallback when the user skips `includes`
  - The optional `includes` step tells the user that skipping it means: use the remote's `maester.yaml` if present, otherwise pull the whole repository
  - No new walkthrough step is added; the existing step's wording changes only

- [x] **P2**: Citadel status reports each source's resolved mode
  - Status output shows the mode recorded by the most recent sync for each source
  - Sources never synced show no mode rather than a guessed one

## 5. Dependencies

- **Maester Sync** ([maester-sync.md](maester-sync.md)) — Owns source fetching and the existing two modes. This feature changes its documented behavior: a manifest-driven source pointed at a repo without `maester.yaml` no longer fails.
- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — Currently rejects an empty manifest; this feature relaxes that rule.
- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Hosts the `includes` prompt whose wording changes, and the source schema that gains `excludes`.
- **Citadel Status** ([citadel-status.md](citadel-status.md)) — Displays the resolved mode (P2).
- **Local Maesters** ([local-maesters.md](local-maesters.md)) — Path sources (local directories, git or not) follow the same mode resolution; for them, "whole repository" means the whole directory. Link materialization follows the link-mode behavior defined there.

**External dependencies:** None

## 6. Assumptions & Risks

**Assumptions:**
- Users who skip `includes` and point at a repo without a manifest generally want its content, not an error
- A fixed built-in exclude list covers the most common noise; per-source `excludes` handles the rest
- Remote repositories used as sources are mostly text/documentation, so whole-repo pulls are reasonably sized

**Risks:**
- **Over-pulling large or irrelevant content.** A whole-repo source pulls far more than intended (e.g. a large code repo). *Mitigation:* built-in excludes, prominent whole-repository labelling in sync output, per-source `excludes`, and link-only materialization so the content never enters version control.
- **Machine-specific citadel content.** Linked destinations are not committed, so a fresh clone of the citadel has no whole-repository content until it is synced. *Mitigation:* status reports such sources as never-synced; teams that need a committed snapshot declare paths.
- **Silent behavior change for existing configs.** Sources that previously failed (no `includes`, no manifest) will now populate on next sync. *Mitigation:* the whole-repository label explains the change on the first run; the previous outcome was a failure, so no working setup is altered.
- **Accidental over-publication by maesters.** A repo owner finishes the maester walkthrough with no entries and unintentionally publishes everything. *Mitigation:* explicit confirmation before saving an entry-less manifest; the manifest is committed and reviewable.
- **Exclude list surprises.** A user expects a file that the built-in list skips. *Mitigation:* the effective exclude patterns are written to sync metadata and documented in help.

## 7. Success Metrics

- 100% of sources with no `includes` and no remote manifest sync successfully instead of erroring
- Every whole-repository sync result identifies the mode and how to narrow it, with zero sources synced in that mode unlabelled
- A user can add a doc-only repo as a source and complete a successful first sync without declaring any paths
- No VCS metadata or default-excluded directories ever appear in a whole-repository destination
- No whole-repository destination is ever tracked by version control in the citadel repository

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
