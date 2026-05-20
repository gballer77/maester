---
spec-version: v1
---

# Document Category and Tags

## 1. Overview

**Feature name:** Document Category and Tags

**Summary:** Extends the existing publication-metadata mechanism so that `category` (a single slug) and `tags` (an array of slugs) declared on a published document — either in the maester configuration (per file or per group via path patterns) or, for includes-driven sources, on a citadel `includes` entry — are written into each materialized file at citadel import time, using the same format-specific inline conventions already established for `state`. As with `state`, inline declarations in the source file take precedence over manifest rules.

**Problem being solved:** Today the maester schema accepts `category` and `tags` on each published document, and the citadel schema accepts `tags` on each source, but those values are dropped during sync — only the document's path and resolved state survive into the citadel. Downstream consumers cannot filter or group materialized files by category or tag without consulting the publisher's manifest, which defeats the file-local self-description that state already provides. Propagating these fields into each file's frontmatter or header makes every file in the citadel uniformly classifiable on its own terms.

## 2. Users & Use Cases

**Primary users:**
- Maesters (repository owners publishing documents) who want to classify their published documents by topic or kind
- Citadel maintainers aggregating heterogeneous content who need a uniform classification scheme across sources
- Downstream readers — humans and AI agents — that filter, group, or prioritize files by category or tag
- Documentation authors marking an individual file's category or tags inline, independent of repo-wide config

**Key use cases:**
1. **Group-level classification.** A maester publishes its `gspec/**/*.md` tree as `category: spec` and its `CHANGELOG.md` as `category: changelog`. Every file imported by a consuming citadel arrives with that category stamped in, so downstream tools can filter "all spec files across all sources" with a single read of each file.
2. **Per-file override by the author.** A specific document inside an otherwise-`spec` group is actually a runbook. The author adds `category: runbook` to the file's frontmatter; the inline value wins over the maester-config rule and the file is materialized with `category: runbook`.
3. **Includes-driven third-party source.** A citadel pulls a public reference repo's docs via an `includes` list. The remote does not publish a maester config. The citadel maintainer tags one entry as `category: reference` with `tags: [external, public-domain]` directly in the citadel config; those values are written into each matched file on sync.
4. **Multi-tag enrichment.** A maester tags its API documentation with `tags: [api, public]` and its internal architecture notes with `tags: [internal, architecture]`. A consuming AI agent loads only files whose tags include `public` when generating customer-facing answers.
5. **Mixed-format publication.** A maester publishes a mix of markdown, HTML, and YAML files. On import, each file format carries category and tags in its native inline convention — frontmatter for markdown, HTML comments for HTML, top-level keys for YAML — so consumers don't need a separate index.

## 3. Scope

**In-scope:**
- Maester-side declaration in the maester configuration: each published-document entry may carry an optional `category` (single slug) and/or optional `tags` (array of slugs); the entry's path or glob is the matching pattern (already accepted by the schema today)
- Citadel-side declaration on includes-driven source entries: each `includes` entry may carry an optional `category` and/or `tags`, as enriched-object fields alongside the existing `path` and `state`
- Inline category and tags declaration in source files using the format-specific conventions already established for `state`:
  - **Markdown**: `category` and `tags` fields in YAML frontmatter at the head of the file
  - **HTML**: top-of-file HTML comments of the form `<!-- category: <slug> -->` and `<!-- tags: <slug>, <slug>, ... -->`
  - **YAML / JSON**: top-level `category` and `tags` keys
  - **Plain text** (`.txt`): single lines `category: <slug>` and `tags: <slug>, <slug>, ...` near the head of the file (within the same leading-metadata block as `state`)
- Resolution precedence at import time, evaluated per file and per field independently: inline value in the source > matching rule (maester-config rule for manifest-driven sources, citadel-side rule for includes-driven sources) > unset
- Each field resolves independently — a file may have inline `category` but no inline `tags`; in that case the rule's `tags` (if any) still applies
- At citadel import, each materialized file in a supported inline format carries the resolved `category` and `tags` inline (when a value is set); if the resolution yields no value for a field, that field is not written
- Files in formats without a supported inline pattern (binary assets, images, PDFs, anything outside the v1 inline-format list) are materialized untagged for category/tags; the run does not fail
- Validation of `category` and `tags` values at every entry point (maester config, citadel config, inline) — both must be lowercase kebab-case slugs; non-slug values are rejected with a clear error

**Out-of-scope:**
- Sidecar metadata files for binary or unsupported-format content (deferred — see below)
- A query interface that reports category/tag breakdown across the citadel after import (downstream concern)
- Editing tools that change a file's category or tags after import (e.g., a CLI verb to reclassify files)
- A controlled vocabulary or registry of allowed category/tag values; both remain free-form slugs in v1
- Hierarchical categories (e.g., `spec/feature` vs `spec/architecture`); a category is a single flat slug
- Tag-based merging when both inline and rule declare `tags` — precedence is inline-wins for the entire `tags` field, not a per-tag union
- Mutation of the original maester source files; the citadel's materialized copy is the only place inline values are written by this feature
- Cross-file enforcement (e.g., "every file in this directory must have category X")

**Deferred ideas:**
- Sidecar metadata files (e.g., `<filename>.meta`) for binary/unsupported formats
- A merge/union policy for `tags` when inline and rule both declare values
- Hierarchical or namespaced categories
- A controlled vocabulary defined in the maester or citadel config that constrains accepted values
- Sync-time filtering (e.g., "only pull files tagged `public`")
- A "classify" / "reclassify" CLI verb that updates inline category/tags across a set of files
- Carrying the optional `description` field through to inline metadata (currently manifest-only)
- A standardized category/tag convention for source code files (`.js`, `.py`, etc.)

## 4. Capabilities

- [ ] **P0**: Maester config entries can declare optional `category` (single slug) and `tags` (array of slugs)
  - Each published-document entry in the maester config accepts optional `category` and `tags` fields (already accepted by today's schema; this capability codifies their semantics during sync)
  - `category` must be a single lowercase kebab-case slug; any other value fails config validation with a clear, actionable error
  - `tags` must be an array of lowercase kebab-case slugs; non-slug values fail validation with a clear error
  - The values are interpreted as applying to every file matched by that entry's path or glob
  - Both fields remain optional everywhere; entries without category or tags remain valid

- [ ] **P0**: Citadel includes entries can declare optional `category` and `tags`
  - Each entry in a source's `includes` list accepts optional `category` and `tags` fields, in the same enriched-object form already used for `state`
  - Bare-string `includes` entries remain valid; the enriched form (`{ path, state?, category?, tags? }`) is the way to add per-include classification
  - Validation rejects non-slug values with a clear error pointing at the offending source and entry
  - The feature works uniformly across manifest-driven and includes-driven sources — the only difference is where the rule is declared

- [ ] **P0**: Files can declare their own category and tags inline using format-specific conventions
  - **Markdown**: `category` and `tags` fields inside YAML frontmatter at the top of the file
  - **HTML**: first-content HTML comments of the form `<!-- category: <slug> -->` and `<!-- tags: <slug>, <slug>, ... -->`
  - **YAML / JSON**: top-level `category` and `tags` keys
  - **Plain text** (`.txt`): lines `category: <slug>` and `tags: <slug>, <slug>, ...` within the leading-metadata block at the head of the file (alongside `state`)
  - Values are validated as slugs; an inline value that is not a valid slug surfaces a per-file warning, is treated as if no inline value were declared for that field, and falls through to rule resolution (it does not by itself fail the file or the source)
  - Absence of an inline value is not an error — it just means the file relies on rule resolution for that field

- [ ] **P0**: Resolution precedence is inline > rule > unset, per field independently
  - When a file has an inline `category`, that value is authoritative regardless of any matching rule's `category`
  - When a file has no inline `category` and exactly one rule matches with a `category`, the rule's value is used
  - When neither applies, the file's `category` is unset and no `category` field is written into the materialized file
  - The same precedence applies independently to `tags` — a file may inherit `category` from the rule while overriding `tags` inline, or vice versa
  - The resolution decision for each file and field is deterministic and reproducible across runs

- [ ] **P0**: At citadel import, every materialized file in a supported inline format carries the resolved category and tags inline
  - On successful import of a markdown file, the destination copy contains `category` and/or `tags` fields in frontmatter (added or updated to match the resolved values; absent when unset)
  - On successful import of an HTML/YAML/JSON/plain-text file, the destination copy contains the resolved values in that format's inline convention (added or updated; absent when unset)
  - When the source already contained the correct inline values, the destination content is byte-identical to the source for that aspect (no spurious diffs)
  - Tags are written in a stable, deterministic order (the order declared in the rule, or the order present inline) so re-runs produce identical bytes
  - The write is scoped to the citadel's local destination; the original maester source file is never modified by this feature

- [ ] **P0**: Files in formats without a supported inline pattern are materialized without category/tags
  - Binary assets, images, PDFs, and any file type outside the v1 inline-format list are materialized at the citadel destination without category or tags
  - The run does not fail and the file is not skipped — only its category/tags writing is skipped
  - A future feature may add sidecar metadata for these formats; this PRD does not block on that

- [ ] **P0**: Category and tags are restricted to kebab-case slugs everywhere
  - Maester config validation, citadel config validation, and inline parsing all enforce the lowercase kebab-case slug pattern
  - Out-of-vocabulary inline values surface a per-file warning and are treated as if no inline value were present for that field (see precedence capability)
  - The schema marker in each config file leaves room to expand allowed value patterns in a later spec version without breaking v1 consumers

- [ ] **P1**: Sync output reports the per-source category/tag breakdown
  - Each source's section of the sync summary includes counts of files materialized per resolved `category` value, and a roll-up of distinct tags applied
  - The breakdown is shown in both human-readable mode and structured (`--json`) output
  - Files with no resolved category (or no resolved tags) are reported under an explicit "unclassified" / "untagged" bucket so the totals reconcile

- [ ] **P1**: Verbose sync output names the source of truth for each file's resolved category and tags
  - When verbose output is requested, each file is listed with its resolved category and tags and the origin of each (`inline`, `rule`, or `unset`)
  - The verbose listing is opt-in and does not appear in the default output
  - This is the diagnostic path for understanding unexpected category/tag outcomes

- [ ] **P2**: Sync warns when an inline value and a matching rule disagree
  - When a file carries an inline `category` (or `tags`) and a matching rule would have produced a different value, the run still uses the inline value (precedence is fixed), but logs an informational warning naming the file, the field, and both values
  - The warning is informational only; it does not fail the file or the source
  - The warning can be silenced via output flags

## 5. Dependencies

- **Document State Tagging** ([document-state-tagging.md](document-state-tagging.md)) — Establishes the four inline-format conventions (markdown frontmatter, HTML comment, YAML/JSON top-level keys, plain-text first-line block), the resolution-precedence model (inline > rule > default), and the post-import file-rewrite mechanism. This feature reuses all three for `category` and `tags`, with one difference: the "default" tier is "unset" rather than a fixed value.
- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — The `category` and `tags` fields are already present in the maester config schema and prompted for during the publish walkthrough. This feature codifies how those values flow through to materialized files.
- **Maester Sync** ([maester-sync.md](maester-sync.md)) — Performs the per-file, per-field resolution at import and writes the resolved category and tags into each materialized file in the citadel destination, alongside the existing state-write pass.
- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Extends the citadel config's enriched `includes` entry form to optionally accept `category` and `tags`, alongside the existing `path` and optional `state`. The init walkthrough may prompt for these per entry when an `includes` list is being declared.

**External dependencies:**
- None

## 6. Assumptions & Risks

**Assumptions:**
- The four inline formats supported by `state` (markdown, HTML, YAML/JSON, plain text) are also the right coverage set for `category` and `tags`; richer-format support is deferred
- Lowercase kebab-case slugs are sufficient as the value vocabulary for both fields in v1; controlled vocabularies and namespacing are deferred
- The inline-wins precedence model that already applies to `state` is the right model for `category` and `tags`, allowing authors to override repo-wide rules per file
- Maester configs and citadel configs are trusted, repo-committed artifacts; their category/tag declarations do not need to be defended against tampering
- The citadel destination is owned by sync; rewriting materialized files to add inline category/tags is consistent with the existing posture (already established by the state feature)
- The original maester source files are off-limits to this feature; only the citadel's local copy is rewritten

**Risks:**
- **Spurious diffs on first import after upgrade.** Adding inline category/tags to files that previously had only `state` (or no inline metadata) will produce a one-time content change in the citadel destination. *Mitigation:* the citadel destination is already a managed, sync-owned tree; the rewrite is idempotent thereafter, and tags are written in a stable order.
- **Tag ordering instability.** If tags are written in inconsistent orders across runs, every sync will produce a noisy diff. *Mitigation:* tags are written in a single deterministic order (declared order from the rule, or preserved inline order from the source).
- **Ambiguous inline-tags syntax in HTML and plain-text formats.** Comma-separated inline tag lists in HTML comments and plain-text headers can collide with other content patterns. *Mitigation:* each format has a strict parse-and-write rule with the same shape used for `state` writes; ambiguous inputs are treated as "no inline value" and fall through to rule resolution rather than failing the file.
- **Schema expansion in two configs.** Adding `category` and `tags` semantics to both maester and citadel configs widens the schema surface in two places. *Mitigation:* both fields are optional everywhere and bounded to slug values; both configs already carry a schema/version marker so future migrations remain possible. The fields already exist in today's maester schema, so most of the surface change is on the citadel-includes side.
- **Inline-wins surprises after a manifest update.** A maester adds a `tags` rule expecting it to apply across the matched glob, but several files already carry inline tags and don't get the new value. *Mitigation:* the P2 disagreement warning and the P1 verbose source-of-truth listing make the divergence diagnosable.
- **Untagged binary content.** Downstream consumers reasoning over the citadel will see some files without category/tags. *Mitigation:* this is an accepted v1 tradeoff (consistent with the state feature); a future sidecar-metadata feature can close the gap.

## 7. Success Metrics

- After import, every file in a supported inline format whose resolution yields a `category` or `tags` value carries that value inline in the citadel destination (no values are silently dropped between manifest and file)
- Re-running sync on an unchanged source produces zero content diffs in the destination once inline category/tags have been materialized (idempotent, including stable tag order)
- A downstream consumer can determine any single citadel file's category and tags by reading the file alone — no consultation of the maester or citadel config is required
- Misconfigured category or tags values (in any of the three declaration sites) fail validation with a clear, field-named error rather than producing silently wrong output

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
