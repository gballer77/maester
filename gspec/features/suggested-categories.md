---
spec-version: v1
---

# Suggested Categories

## 1. Overview

**Feature name:** Suggested Categories

**Summary:** Ships a built-in starter list of recommended document categories. The list is offered wherever a maester chooses a category for a published document. It is a recommendation only: any valid category slug is still accepted everywhere. Files in formats that can't hold inline metadata, such as source code, are reported under the category their config entry gives them instead of being counted as unclassified.

**Problem being solved:** Categories are free-form slugs. Their main value is consistency *across* sources: a citadel aggregating many repositories should be able to group "all specs" or "all runbooks" in one pass. With no shared starting point, each maester invents its own words (`spec`, `specs`, `specification`, `src`, `source`), and cross-source grouping fragments from the first publish onward. Today the only guidance is example text in a prompt. A small, well-chosen default list prevents most of that drift without the cost of an enforced vocabulary. Separately, publishing source code is a legitimate use case, especially when a repository's written documentation is thin. Today such files are counted as "unclassified" at sync even though the config gave them a category.

## 2. Users & Use Cases

**Primary users:**
- Maesters (repository owners) configuring which documents to publish and how to classify them
- AI coding agents proposing a maester configuration on a user's behalf
- Citadel maintainers and downstream readers who group or filter content by category across sources

**Key use cases:**
1. **First-time publish.** A maester runs the interactive publish flow in a repository with no existing categories. When asked for a category, they pick `runbook` from a short list instead of inventing a word. Another repository consumed by the same citadel picks `runbook` the same way, and both group together downstream.
2. **Consistent reuse.** In a repository that already uses `spec` and `adr`, the category picker shows those values first, then the rest of the starter list, so the maester extends the vocabulary already in use.
3. **Publishing source code.** A repository with sparse written docs publishes `src/**` as `source-code` so agents reading the citadel can consult the implementation. Sync reports those files under `source-code`, not "unclassified", even though nothing is written into the source files.
4. **Near-miss nudge.** A maester types `specs` as a custom category. The tool suggests `spec`, but accepts `specs` if the maester keeps it.

## 3. Scope

**In-scope:**
- A fixed, built-in starter list of ten categories: `readme`, `spec`, `adr`, `runbook`, `guide`, `reference`, `api-reference`, `changelog`, `policy`, `source-code`
- Offering the starter list, merged with categories already in use in the repository, wherever a category is chosen for a maester config entry, both in the interactive publish/add prompts and in the AI-aided Publisher
- A custom ("Other…") path that accepts any valid category slug, as today
- Reporting files whose format can't hold inline metadata under the category from their config entry, instead of "unclassified"
- A non-blocking near-miss suggestion when a typed category is a close variant of a starter-list value

**Out-of-scope:**
- Enforcing the starter list: config validation, inline parsing and sync continue to accept any valid category slug
- Writing category (or tags) into source code or other formats without an inline metadata convention. For those formats, the maester config is the sole record of category.
- Category suggestions in the citadel's `includes` classification prompts
- A starter list for tags
- Near-miss checks at sync time or against inline values in files
- General fuzzy matching beyond plurals and a small, fixed alias set

**Deferred ideas:**
- User- or citadel-defined additions to the suggested list (e.g., a shared vocabulary declared in a citadel config)
- Extending the picker to the citadel `includes` prompts
- Sync-time warnings for near-miss categories found in config rules or inline values
- A suggested starter list for tags
- Short descriptions shown alongside each starter category in the picker

## 4. Capabilities

- [ ] **P0**: A built-in starter list of recommended categories exists in one place
  - The list contains exactly: `readme`, `spec`, `adr`, `runbook`, `guide`, `reference`, `api-reference`, `changelog`, `policy`, `source-code`
  - Every value is a valid category slug under existing validation rules
  - The list is defined once and consumed by every surface that suggests categories; there is no second copy to drift
  - Config validation is unchanged: a category not on the list but matching the slug rule is still valid everywhere

- [ ] **P0**: The interactive publish and add prompts offer a category picker
  - When choosing a category for a document, the user sees a selectable list of categories already used in the repository's manifest and inline headers, followed by the remaining starter-list values, with no duplicates
  - The picker includes a "no category" choice and an "Other…" choice; "Other…" accepts free text subject to the existing slug validation
  - Selecting a listed value produces the same config entry as typing that value by hand
  - The initial-publish README entry continues to default to `readme`

- [ ] **P0**: The AI-aided Publisher uses the starter list as a fallback vocabulary
  - The Publisher's machine-readable inventory output exposes the starter list alongside the categories already in use, distinguishing the two
  - The Publisher instructs the agent to prefer, in order, a category already in use, then a starter-list value, and only then a new value, which is labelled "new" in the proposal
  - In a repository with no existing categories, a proposal for a typical documentation layout uses starter-list values rather than near-synonyms

- [ ] **P0**: Files whose format can't hold inline metadata are reported under their config category
  - When a file in an unsupported inline format (e.g., source code, images) matches a config entry that sets a category, the sync category breakdown counts it under that category, not "unclassified"
  - Verbose sync output shows the category as coming from the config rule and notes that it was not written into the file
  - The materialized file's content is unchanged; nothing is written into source code or other unsupported formats
  - Files with no resolved category from any source are still reported as "unclassified", so totals reconcile

- [ ] **P2**: Near-miss categories trigger a non-blocking suggestion
  - When a typed category is a plural of a starter-list value (e.g., `specs`, `runbooks`) or one of a fixed alias set (`src` and `source` → `source-code`, `docs` → `guide`, `changes` → `changelog`), the user is told which starter value it resembles
  - In the interactive prompt, the user can switch to the suggested value or keep what they typed. In the non-interactive add/update commands, the suggestion is printed as a warning and the typed value is saved.
  - A value already used elsewhere in the repository never triggers a suggestion, so established vocabularies are left alone
  - The suggestion never fails validation or changes the exit code

## 5. Dependencies

- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)): owns the interactive publish walkthrough where the category picker appears.
- **Config Editing** ([config-editing.md](config-editing.md)): owns the `publish add` flow that also gains the picker.
- **AI-aided Maester Definition** ([ai-aided-maester-definition.md](ai-aided-maester-definition.md)): owns the Publisher, its inventory output, its vocabulary-reuse guidance and the non-interactive add/update commands.
- **Document Category and Tags** ([document-category-and-tags.md](document-category-and-tags.md)): defines category semantics, resolution precedence and the sync category breakdown that this feature adjusts for unsupported formats.

**External dependencies:**
- None

## 6. Assumptions & Risks

**Assumptions:**
- Ten categories cover the large majority of what maesters publish; anything else is handled by "Other…"
- For formats with no inline metadata convention, the maester config is an acceptable and sufficient record of a file's category
- Suggesting categories, without enforcing them, is enough to reduce drift meaningfully
- Repositories that already use non-starter categories prefer to keep them, so existing values are always shown first and never flagged

**Risks:**
- **The list becomes a de facto standard that's hard to change.** Renaming or removing a starter value later would leave published configs out of step. *Mitigation:* the list is suggestion-only, so existing values stay valid; additions are cheap, and removals are avoided.
- **Downstream readers can't see a source file's category from the file alone.** Unlike documents, source files in the citadel don't carry their category. *Mitigation:* this is an accepted tradeoff; sync reporting attributes the category correctly, and a future change can expose config-derived categories to readers if needed.
- **The near-miss alias set feels arbitrary.** *Mitigation:* it is small, fixed and non-blocking, and an established in-repo value always suppresses it.

## 7. Success Metrics

- In a repository with no prior categories, every category chosen through the interactive picker or a default Publisher proposal is a starter-list value, unless the user explicitly picks "Other…"
- No config that was valid before this feature becomes invalid after it
- Sync never reports a file as "unclassified" when a matching config entry assigns it a category, regardless of file format
- A typed plural or listed alias of a starter value always produces a suggestion, and never blocks the save

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
