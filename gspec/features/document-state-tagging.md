---
spec-version: v1
---

# Document State Tagging

## 1. Overview

**Feature name:** Document State Tagging

**Summary:** A lightweight state model that lets a maester (the publishing repo) mark each published document as either `draft` or `canon`, declared either in the maester configuration (per file or per group via path patterns) or inline at the head of the file (frontmatter for markdown, format-specific patterns for a few other text formats). At citadel import time the resolved state is written into each materialized file inline, so every file in the citadel is self-describing about its publication state.

**Problem being solved:** Today, a maester publishes a set of documents with no signal about which ones are stable enough to rely on. Downstream consumers — humans reading the citadel and AI agents reasoning over it — cannot tell at a glance whether a given document is a settled, authoritative reference or a work-in-progress draft. Tagging that distinction at publication time, and materializing it at the file level on import, gives every consumer a uniform, file-local way to filter, prioritize, and reason about content without having to consult an external manifest.

## 2. Users & Use Cases

**Primary users:**
- Maesters (repository owners publishing documents) who want to signal which of their published documents are authoritative
- Citadel maintainers aggregating content from sources they don't fully control
- Downstream readers — humans and AI agents — that need to distinguish stable references from in-progress drafts
- Documentation authors marking an individual document's state without touching repo-wide config

**Key use cases:**
1. **Group-level publication state.** A maester publishes a stable runbooks directory and a WIP architecture-notes directory. In its maester config it tags the runbook entry as `canon` and the architecture entry as `draft`. Every file imported by a consuming citadel arrives with that state stamped in.
2. **Per-file override by the author.** A specific document inside an otherwise-canon group is being actively rewritten. The author adds `state: draft` to the file's frontmatter; the inline tag wins over the maester-config rule and the file is published as draft.
3. **Includes-driven third-party source.** A citadel pulls a public reference repo's docs via an `includes` list. The remote does not publish a maester config. The citadel maintainer marks the entire source as `draft` via a citadel-side tagging rule because the third party is in flux.
4. **AI-agent filtering.** An AI coding agent reading the citadel filters to `state: canon` files when looking for authoritative answers, and treats `state: draft` files as informational context only.
5. **Mixed-format publication.** A maester publishes a mix of markdown, HTML, and YAML files. On import, each file format carries the state in its native inline convention — frontmatter for markdown, HTML comment for HTML, top-level key for YAML — so consumers don't need a separate index.

## 3. Scope

**In-scope:**
- Two-value state vocabulary in v1: `draft` and `canon`
- Maester-side tagging in the maester configuration: each published entry may carry a `state` field; the entry's path or glob is the matching pattern
- Citadel-side tagging on includes-driven source entries: each `includes` entry may carry a `state` field
- Inline state declaration in source files using format-specific conventions:
  - **Markdown**: `state` field in YAML frontmatter at the head of the file
  - **HTML**: top-of-file HTML comment of the form `<!-- state: <value> -->`
  - **YAML / JSON**: top-level `state` key
  - **Plain text** (`.txt`): a single line `state: <value>` as the first line of the file
- Resolution precedence at import time, evaluated per file: inline state in the source > matching rule (maester-config rule for manifest-driven sources, citadel-side rule for includes-driven sources) > default (`draft`)
- Default state is `draft` when no inline tag and no rule applies
- At citadel import, each materialized file in a supported inline format carries its resolved state inline — written into the file's content at the citadel destination using the format's inline convention
- Files in formats without a supported inline pattern (binary assets, images, PDFs, anything outside the v1 inline-format list) are materialized untagged; the run does not fail
- Validation of state values at every entry point (maester config, citadel config, inline) — values other than `draft` or `canon` are rejected with a clear error

**Out-of-scope:**
- Sidecar metadata files for binary or unsupported-format content (deferred — see below)
- A query interface that reports state breakdown across the citadel after import (downstream concern)
- Editing tools that flip state values on a file (e.g., a "promote to canon" CLI verb)
- Workflow concepts beyond the state value itself (review status, owners, expiry, approval chains)
- Tagging that mutates the original maester source files; the citadel's materialized copy is the only place inline tags are written by this feature
- Conflict-resolution UX when a file already carries an inline state but the resolved state from the rule differs (precedence is fixed; no interactive prompt)

**Deferred ideas:**
- Sidecar metadata files (e.g., `<filename>.state`) for binary/unsupported formats
- Additional state values (`archived`, `proposed`, `rejected`, etc.) and a configurable vocabulary
- A "promote" / "demote" CLI verb that updates inline state across a set of files
- A lint capability that warns when a `canon` file references a `draft` file
- State-aware filtering at sync time (e.g., "only pull canon files")
- State histories / state transitions recorded over time
- A standardized state convention for source code files (`.js`, `.py`, etc.)

## 4. Capabilities

- [ ] **P0**: Maester config entries can declare a `state` field of `draft` or `canon`
  - Each published-document entry in the maester config accepts an optional `state` field
  - Accepted values are exactly `draft` and `canon`; any other value fails config validation with a clear, actionable error
  - The state is interpreted as applying to every file matched by that entry's path or glob
  - The field is optional everywhere; entries without a state remain valid

- [ ] **P0**: Citadel config entries for includes-driven sources can declare a per-entry `state` field
  - Each entry in a source's `includes` list accepts an optional `state` field of `draft` or `canon`
  - Includes that today are bare path strings remain valid; the enriched object form (`{ path, state }`) is the way to add a state
  - Validation rejects unknown state values with a clear error pointing at the offending source and entry
  - The feature works uniformly across manifest-driven and includes-driven sources — the only difference is where the rule is declared

- [ ] **P0**: Files can declare their own state inline using format-specific conventions
  - **Markdown**: a `state` field inside YAML frontmatter at the top of the file
  - **HTML**: a first-content HTML comment of the form `<!-- state: <value> -->`
  - **YAML / JSON**: a top-level `state` key with a string value
  - **Plain text** (`.txt`): a single line `state: <value>` as the first line of the file
  - Values are validated as `draft` or `canon`; an inline value outside that set surfaces a per-file warning, is treated as if no inline state were declared, and falls through to rule/default resolution (it does not by itself fail the file or the source)
  - Absence of an inline state is not an error — it just means the file relies on rule resolution

- [ ] **P0**: Resolution precedence is inline > rule > default
  - When a file has an inline state, that state is authoritative regardless of any matching maester-config or citadel-config rule
  - When a file has no inline state and exactly one rule matches, the rule's state is used
  - When neither applies, the file's resolved state is `draft`
  - The resolution decision for each file is deterministic and reproducible across runs

- [ ] **P0**: At citadel import, every materialized file in a supported inline format carries the resolved state inline
  - On successful import of a markdown file, the destination copy contains a `state` field in frontmatter (added or updated to match the resolved value)
  - On successful import of an HTML/YAML/JSON/plain-text file, the destination copy contains the resolved state in that format's inline convention (added or updated)
  - When the source already contained the correct inline state, the destination content is byte-identical to the source for that aspect (no spurious diffs)
  - The write is scoped to the citadel's local destination; the original maester source file is never modified by this feature

- [ ] **P0**: Files in formats without a supported inline pattern are materialized untagged
  - Binary assets, images, PDFs, and any file type outside the v1 inline-format list are materialized at the citadel destination without any state tag
  - The run does not fail and the file is not skipped — only its tagging is skipped
  - A future feature may add sidecar metadata for these formats; this PRD does not block on that

- [ ] **P0**: State vocabulary is restricted to `draft` and `canon` everywhere
  - Maester config validation and citadel config validation reject unknown state values with a clear, field-named error at parse time
  - Inline-tag parsing recognizes the same two-value vocabulary; out-of-vocabulary inline values surface a per-file warning and are treated as if no inline state were present (see precedence capability)
  - The schema marker in each config file leaves room to expand the vocabulary in a later spec version without breaking v1 consumers

- [ ] **P1**: Sync output reports the per-source state breakdown
  - Each source's section of the sync summary includes counts of `canon`, `draft`, and `untagged` files materialized
  - The breakdown is shown in both human-readable mode and structured (`--json`) output
  - Untagged here means a supported-format file whose tagging step was skipped or an unsupported-format file (the categories are distinguishable in structured output)

- [ ] **P1**: Verbose sync output names the source of truth for each file's resolved state
  - When verbose output is requested, each file is listed with its resolved state and the origin of that decision (`inline`, `rule`, or `default`)
  - The verbose listing is opt-in and does not appear in the default output
  - This is the diagnostic path for understanding unexpected state outcomes

- [ ] **P2**: Sync warns when an inline state and a matching rule disagree
  - When a file carries an inline state and a rule would have produced a different state, the run still uses the inline value (precedence is fixed), but logs an informational warning naming the file and both values
  - The warning is informational only; it does not fail the file or the source
  - The warning can be silenced via output flags

## 5. Dependencies

- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — Extends the maester config entry schema with an optional `state` field. The configuration walkthrough may prompt for state on each entry (UI nicety, not required for the feature).
- **Maester Sync** ([maester-sync.md](maester-sync.md)) — Performs the per-file state resolution at import and writes the resolved state into each materialized file in the citadel destination.
- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Extends the citadel config's `includes` entry schema to optionally accept an object form carrying `state`, alongside the existing bare-string form.

**External dependencies:**
- None

## 6. Assumptions & Risks

**Assumptions:**
- A two-value vocabulary (`draft`, `canon`) is sufficient for v1; richer workflows are deferred
- Maester configs and citadel configs are trusted, repo-committed artifacts; their state declarations do not need to be defended against tampering
- The citadel destination is owned by sync; rewriting materialized files to add inline state is consistent with the existing posture that the destination is managed output
- Markdown, HTML, YAML/JSON, and plain text are the most common publication formats in v1 maesters; coverage of those four formats covers the bulk of real content
- The original maester source files are off-limits to this feature; only the citadel's local copy is rewritten with inline state

**Risks:**
- **Spurious diffs on first import after upgrade.** Adding inline state to files that previously had none will produce a one-time content change in the citadel destination. *Mitigation:* the citadel destination is already a managed, gitignored or sync-owned tree; the rewrite is idempotent thereafter.
- **Format-specific parsing edge cases.** A markdown file with no existing frontmatter, an HTML file with a doctype before any comment, a JSON file at the top level being an array rather than an object, or a plain-text file whose first line happens to begin with `state:` could all surprise the parser. *Mitigation:* each inline format has a well-defined parse and write rule that handles "no existing state" and "existing state" symmetrically; the plain-text rule requires an exact `state: <value>` shape on line 1 to avoid false positives.
- **Drift between inline state and rule.** An author updates inline state but forgets the matching rule (or vice versa), producing confusing precedence outcomes. *Mitigation:* the P2 disagreement warning and the P1 verbose source-of-truth listing make this diagnosable.
- **Untagged binary content lacks state.** Downstream consumers reasoning over the citadel will see some files without state. *Mitigation:* this is an accepted v1 tradeoff; a future sidecar-metadata feature can close the gap.
- **Schema expansion in two configs.** Adding a `state` field to both maester and citadel configs widens the schema surface in two places. *Mitigation:* the field is optional everywhere and bounded to two values; both configs already carry a schema/version marker so future migrations remain possible.

## 7. Success Metrics

- After import, 100% of files in supported inline formats carry an inline `state` value in the citadel destination
- Re-running sync on an unchanged source produces zero content diffs in the destination once inline state has been materialized (idempotent)
- A downstream consumer can determine any single citadel file's state by reading the file alone — no consultation of the maester or citadel config is required
- Misconfigured state values (in any of the three declaration sites) fail validation with a clear, file-or-entry-named error rather than producing silently wrong output

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
