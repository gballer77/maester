---
spec-version: v1
---

# Quick Publish

## 1. Overview

**Feature name:** Quick Publish

**Summary:** Turning a repository into a maester takes one confirmation, or none. The tool detects common documentation layouts and proposes entries for them. The walkthrough asks only for paths, and metadata becomes a single opt-in at the end. A non-interactive mode writes the detected entries with no prompts at all.

**Problem being solved:**
- The publish walkthrough asks five questions per entry: path, state, description, category and tags. Four of them are optional, but each one still has to be answered or skipped. For a repository owner who just wants "publish our docs", that's the most tedious part of onboarding.
- The only built-in suggestion is the root README. Recognizable layouts (a docs directory, architecture decision records, spec folders, doc-site generator roots, changelogs) must be typed by hand, even though they can be detected deterministically.
- There's no way to create a manifest without prompts unless the user writes a change set or installs an agent integration. Bootstrap scripts and bulk rollouts across many repositories have no simple path.

## 2. Users & Use Cases

**Primary users:**
- Repository owners making their repository a maester for the first time
- Platform or developer-experience engineers rolling maester manifests out across many repositories
- Citadel maintainers drafting manifests for repositories they don't own (through [Citadel-Driven Onboarding](citadel-driven-onboarding.md))

**Key use cases:**
1. **Two keystrokes.** An owner runs the publish walkthrough. It shows four detected entries, all pre-selected: `README.md`, `docs/**` (generator root), `docs/adr/*.md` (category `adr`) and `CHANGELOG.md` (category `changelog`). The owner presses enter, declines metadata, and the manifest is written.
2. **Paths only, metadata later.** An owner adds two custom globs. When asked whether to add descriptions, categories and tags now, they decline. The agent integration or the update command can fill them in later.
3. **Scripted rollout.** A platform engineer runs the non-interactive publish across forty repositories. Each repository gets a manifest of its detected entries. The six repositories where nothing was detected are reported as failures with nothing written, so they can be handled by hand.
4. **Safe re-run.** A script runs the non-interactive publish in a repository that already has a manifest. It exits non-zero, leaves the file alone, and points at the editing commands.

## 3. Scope

**In-scope goals:**
- Deterministic detection of common documentation layouts, each yielding a proposed path or glob, an optional category, and a one-line reason.
- Detection results exposed in the read-only inventory's machine-readable output, so other flows and agents reuse them.
- A walkthrough that offers detected entries as a pre-selected multi-choice, asks only for a path for each manually added entry, and asks once at the end whether to add metadata.
- A non-interactive publish mode that writes exactly the detected entries, plus a dry-run variant.

**Out-of-scope:**
- Any model or network call during detection.
- Reading document content beyond the inline metadata the inventory already reads.
- Changing an existing manifest from quick or non-interactive mode. Existing manifests are edited through the existing editing commands.
- Writing inline metadata into documents.

**Deferred ideas:**
- A per-organization detection rule file, so teams can add their own layouts.
- Non-interactive mode accepting extra explicit paths alongside the detected ones.
- Detecting state (`canon` vs `draft`) from signals like directory names or file headers.

## 4. Capabilities

- [ ] **P0**: The tool detects common documentation layouts and proposes entries for them
  - Detection covers at least:
    - a root README;
    - a top-level docs directory;
    - architecture decision record directories (category `adr`);
    - spec directories such as living-spec folders (category `spec`);
    - doc-site generator roots, identified by their configuration file;
    - root changelog and contributing guides (categories `changelog`, `contributing`);
    - API description files (category `api`).
  - Each suggestion has a path or glob, an optional category, and a one-line reason naming the signal that triggered it (for example "found `mkdocs.yml` pointing at `docs/`").
  - Detection is deterministic: the same tree always produces the same suggestions in the same order. It applies the built-in excludes and never suggests a path that matches a likely-sensitive file.
  - Overlapping suggestions are collapsed to the broader glob, and the narrower one is dropped. A narrower suggestion is kept only when it adds a category the broader one lacks.
- [ ] **P0**: The publish walkthrough asks only for paths, with one metadata opt-in at the end
  - Detected suggestions are shown first as a multi-choice, all pre-selected, each with its reason. The user can deselect any of them.
  - The user can then add entries manually. Each manual entry prompts only for its path, keeping the existing glob match count and the "does not exist yet" warning.
  - After the entries are collected, a single question asks whether to add descriptions, categories, tags and state now. If yes, the existing per-entry metadata prompts run for each entry, pre-filled with any detected category. If no, entries are written with only path and detected category.
  - This flow replaces the previous five-prompts-per-entry walkthrough and the README-only suggestion. Existing-manifest detection, path validation and next-step guidance are unchanged.
- [ ] **P0**: A non-interactive publish writes the detected entries with no prompts
  - A flag on the publish command writes a new manifest containing exactly the detected suggestions, with no prompts. It exits zero and reports each entry written with its reason.
  - If a manifest already exists, it exits non-zero, writes nothing, and names the editing commands to use instead.
  - If nothing is detected, it exits non-zero, writes nothing, and suggests the interactive walkthrough. It never falls back to a whole-repository manifest.
  - Machine-readable output is available, using the same success and error shape as the other non-interactive publish commands.
- [ ] **P1**: Detected suggestions are exposed in the inventory output
  - The read-only inventory's machine-readable output includes the suggestion list with path, category and reason. It also marks whether each suggestion is already covered by an existing entry.
  - The agent integration's instructions tell the agent to start from these suggestions.
- [ ] **P1**: Non-interactive publish supports a dry run
  - With a dry-run flag, the non-interactive publish prints the manifest it would write, including any header the tool adds, and writes nothing. Exit codes match a real run, so scripts can preflight.

## 5. Dependencies

- [Maester Configuration](maester-configuration.md): the walkthrough being streamlined. This feature supersedes its P2 README-only suggestion capability.
- [AI-Aided Maester Definition](ai-aided-maester-definition.md): the read-only inventory, the sensitive-file detection, the non-interactive write path and its output shape, all reused here.
- [Whole-Repository Sources](whole-repository-sources.md): the built-in excludes detection applies.
- [Document Category and Tags](document-category-and-tags.md): slug rules for detected categories.
- [Config JSON Schemas](config-json-schemas.md): manifests created here carry the schema header once that feature lands.

**External dependencies:** None.

## 6. Assumptions & Risks

**Assumptions:**
- A small, fixed set of layouts covers most repositories' documentation well enough for a first manifest.
- Owners prefer a quick, slightly broad first manifest they can narrow later over a long interview up front.

**Risks & mitigations:**
- **Detection over-publishes** (for example a `docs/` directory full of generated output). Suggestions are shown with reasons and can be deselected. Non-interactive mode prints every entry. The manifest is reviewed in version control before it takes effect.
- **Detection misses a repository's real docs.** Manual entries are always available, and non-interactive mode fails loudly instead of writing something misleading.
- **Users never come back for metadata.** Metadata is optional by design, and sync reports unclassified counts, so the gap stays visible to the citadel.

## 7. Success Metrics

- A repository with a README and a docs directory reaches a written manifest in the interactive walkthrough with at most two confirmations.
- Non-interactive publish never writes a manifest in a repository where nothing was detected, and never modifies an existing manifest.
- Detection produces identical output across repeated runs on an unchanged tree.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
