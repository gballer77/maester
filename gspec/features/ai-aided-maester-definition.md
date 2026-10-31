---
spec-version: v1
---

# AI-Aided Maester Definition

## 1. Overview

**Feature name:** AI-Aided Maester Definition

**Summary:** An installable agent integration, the **Publisher**, that lets the AI coding agent a user already runs propose a repository's maester configuration. The agent inspects the repository and presents a complete proposal: which documents to publish, plus a description, category, tags and state for each. Nothing is written until the user confirms. Approved entries are then saved through the tool's own validated, non-interactive editing commands. The tool itself never calls a model: all of the reasoning happens in the user's agent session.

**Problem being solved:**
- Defining a good publish surface by hand is tedious and easy to get wrong:
  - picking the right paths and globs;
  - writing useful descriptions;
  - choosing consistent categories and tags;
  - deciding canon vs. draft.
- The interactive walkthrough asks one question at a time, but the user still has to know the repository's documentation layout and invent the vocabulary.
- An AI coding agent already sitting in the repository can read the tree and make a strong first proposal in seconds.
- What's missing is a sanctioned, safe way for it to do this. Without one, agents hand-edit the configuration file. That skips validation, invents inconsistent vocabulary, or silently switches a whole-repository manifest to a narrow one.

## 2. Users & Use Cases

**Primary users:**
- Repository owners turning a repository into a maester for the first time
- Documentation maintainers keeping an existing publish surface accurate as the repository grows
- Engineers who already work inside an AI coding agent and prefer to delegate configuration chores to it

**Key use cases:**
1. **Bootstrap a new maester.** In a repository with no maester configuration, the user asks the agent to "set this repo up as a maester".
   - The agent proposes entries, for example `README.md`, `docs/adr/*.md` (category `adr`, state `canon`) and `docs/runbooks/**` (category `runbook`), each with a one-line rationale.
   - The user edits two descriptions and approves.
   - The configuration is written and validated in one pass.
2. **Refine an existing maester.** After a docs reorganization, the user asks the agent to review the manifest. The agent reports:
   - a new `docs/guides/` directory that is not published;
   - one entry whose path no longer matches anything;
   - three entries with no description.

   The user accepts the additions and the removal and declines one description change. Only the accepted changes are written.
3. **Consistent vocabulary.** The repository already uses `category: spec` in its manifest and in some files' inline headers. The agent reuses `spec` rather than inventing `specification`, and reuses existing tags before proposing new ones.
4. **Avoid publishing secrets.** The agent sees an environment file and a credentials directory. It leaves them out and says why, so nothing sensitive ends up in the proposal.

## 3. Scope

**In-scope goals:**
- An installable Publisher integration for the same agent targets as the existing citadel-side agent integration ([Grand Maester Skill](grand-maester-skill.md)).
  - It uses the same install / upgrade / add-target mechanism and the same managed-region rules.
  - It is installable in maester repositories, and in repositories that are both citadel and maester.
- A non-interactive, fully validated way to add, update and remove published-document entries, and to list them in a machine-readable format. These are the only write paths the Publisher uses.
- A read-only repository inventory command that grounds the agent's proposal in what actually exists. It reports:
  - candidate documents;
  - the inline metadata already present in them;
  - which existing entries cover them;
  - likely-sensitive files.
- A proposal-then-confirm workflow encoded in the Publisher. The agent presents the full proposed change set, with a rationale per entry, takes edits, and writes only what the user approves.
- **Create mode:** propose a manifest from scratch when none exists.
- **Refine mode:** for an existing manifest, propose:
  - additions;
  - removals of entries that resolve to nothing;
  - missing descriptions, categories and tags.

**Out-of-scope:**
- The tool calling a language model or AI provider itself. There are no API keys and no model network calls from the tool.
- The agent editing document content, including writing inline state/category/tags headers into documents. The Publisher changes the manifest only.
- Writing to the manifest without explicit user confirmation.
- Defining which sources a citadel pulls. This feature is maester-side only.
- Generating or rewriting documentation.

**Deferred ideas:**
- A drift check the agent runs after large repository changes (new documentation directories, renames) without being asked.
- Optionally letting the agent write inline headers into documents, with confirmation per file.
- A citadel-side counterpart that helps define `includes` for a third-party source with no manifest.
- Running the proposal headless in CI, for example opening a pull request with suggested manifest changes.

## 4. Capabilities

- [ ] **P0**: Published-document entries can be added, updated, removed and listed without prompts
  - Add accepts path, description, category, tags and state as arguments. Update accepts any subset of those, keyed by the entry's path. Every write runs the same validation as the interactive flow (path well-formed and repo-relative, slug rules for category and tags, allowed state values, no duplicate paths). An invalid value exits with a non-zero code and a message naming the field, and leaves the file unchanged.
  - Writes keep comments, key order and untouched entries, and replace the file atomically, exactly like the interactive editing verbs.
  - List supports a machine-readable output that includes every field of every entry, and states explicitly when the manifest publishes the whole repository.
  - Existing guard rails still apply:
    - Removing the last entry is refused.
    - Adding the first entry to a whole-repository manifest needs an explicit acknowledgement argument. Without it, the add is refused with a message explaining that publishing changes from the whole repository to only the listed documents.
- [ ] **P0**: The Publisher integration can be installed for each supported agent target
  - The existing skill-management command can install, upgrade and add targets for the Publisher. Installing it next to the citadel-side integration leaves both working.
  - Install is offered at the end of the interactive maester configuration flow, and is available on its own later.
  - On every target, the installed instructions describe the proposal-then-confirm workflow, the allowed write commands, and the rule that document content is never edited.
  - Upgrade refreshes the Publisher's managed content and keeps sections the user added.
- [ ] **P0**: The agent proposes a complete manifest when none exists, and writes it only after confirmation
  - The proposal lists every entry with its path or glob, description, category, tags, state, and a one-line rationale. It also lists notable exclusions and the reason for each.
  - The agent asks for approval of the whole proposal, applies any edits the user requests, and writes nothing until the user approves.
  - After approval, every entry is written through the non-interactive commands. The agent then shows the resulting entry list and suggests reviewing the change in version control.
  - If the user declines, no maester configuration file is created.
- [ ] **P0**: The agent proposes changes to an existing manifest, and changes only what the user approves
  - The proposal is grouped into additions, removals (entries matching no files) and metadata fill-ins (missing description, category or tags). Each item has a rationale.
  - Existing entries that need no change are left alone. Any change to an existing entry's populated field is called out as a modification and needs its own approval.
  - Declined items are not written. Approved items are written through the non-interactive commands.
- [ ] **P1**: A read-only inventory command reports candidate documents for the agent to reason over
  - Output is machine-readable and lists documentation-like files with their path and size, plus any inline state, category and tags already in the file.
  - Each file is marked with the existing manifest entry that covers it, or as uncovered.
  - It applies the same built-in excludes as whole-repository publishing (version-control, dependency and build directories, binaries, oversized files), and never reads or prints file contents beyond inline metadata.
  - Likely-sensitive files (environment files, key material, credential stores) are flagged so the agent leaves them out.
- [ ] **P1**: Proposals reuse the repository's existing metadata vocabulary
  - The inventory and list output together expose every category and tag already in use, from both the manifest and inline headers.
  - The Publisher instructs the agent to prefer an existing category or tag over a new near-synonym, and to label any newly introduced value as "new" in the proposal.
  - The agent states its state choice per entry: `canon` for authoritative material, `draft` for work in progress, or "file header" when files already carry their own state.
- [ ] **P2**: A preview shows exactly which files each entry would publish
  - For the current or a proposed set of entries, it lists the files each entry resolves to and the effective state, category and tags each file would carry after inline precedence is applied.
  - Entries that resolve to no files, and files matched by more than one entry, are flagged.
  - The preview never writes anything, and the agent can include its summary in a proposal.

## 5. Dependencies

- [Maester Configuration](maester-configuration.md): the manifest format and the validation rules this feature reuses.
- [Config Editing](config-editing.md): the comment-preserving atomic edit engine and the last-entry guard. This feature adds the non-interactive variant that PRD deferred.
- [Grand Maester Skill](grand-maester-skill.md): the target set, the install / upgrade / add-target mechanism, and the managed-region convention.
- [Document State Tagging](document-state-tagging.md) and [Document Category and Tags](document-category-and-tags.md): the vocabularies and the precedence of inline values over manifest values.
- [Whole-Repository Sources](whole-repository-sources.md): the meaning of an empty documents list, and the built-in excludes the inventory reuses.
- **External:** an AI coding agent on one of the supported targets. Without one, the existing interactive flow is unchanged.

## 6. Assumptions & Risks

**Assumptions:**
- Users who want AI help already run a supported coding agent in the repository.
- Instructions plus a small set of validated commands are enough to keep agent behavior safe. Correctness is enforced by the commands, not by the model.
- A whole proposal reviewed in chat, followed by the version-control diff, is enough review for a manifest-sized change.

**Risks & mitigations:**
- **The agent bypasses the commands and hand-edits the file.**
  - The installed instructions name the commands as the only write path.
  - Every command validates the whole file, so a later hand edit that breaks the schema fails on the next run.
  - The version-control diff stays the final review.
- **The agent proposes publishing sensitive files.**
  - The inventory flags likely-sensitive files, and the instructions forbid proposing them.
  - Publishing is still a manifest the user must approve and commit.
- **Silent switch from whole-repository to listed documents.** The first add into an empty manifest needs an explicit acknowledgement argument, and the agent must surface this change in its proposal.
- **Vocabulary sprawl** (near-duplicate categories and tags). Existing values are exposed, reuse is preferred, and new values are labelled so the user can catch them.
- **Large repositories overwhelm the agent's context.** The inventory reports only metadata, never content, and applies the built-in excludes. The agent proposes globs over large uniform directories rather than listing every file.

## 7. Success Metrics

- A user can go from an unconfigured repository to a committed, valid maester configuration through the Publisher, with a single approval step.
- Every manifest write made by the Publisher passes validation on first attempt or fails with a field-specific message and no file change (zero corrupted or partially written manifests).
- In refine mode, entries the user did not approve are byte-identical before and after the run.
- Proposals reuse existing categories and tags whenever an equivalent value exists; newly introduced values are always labelled as new.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
