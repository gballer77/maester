---
spec-version: v1
---

# Config Editing

## 1. Overview

**Feature name:** Config Editing

**Summary:** Three verbs — `add`, `remove`, `list` — that let a user incrementally modify an already-configured `citadel.yaml` or `maester.yaml` through the same interactive wizard used during initialization, instead of opening the file in an editor. Reachable from both the `npx baller-maester` top-level menu (when a config exists) and as direct subcommands.

**Problem being solved:** Today, the citadel-init and maester-publish flows are one-shot wizards: they refuse to run when their target file already exists, leaving the user with no option but to hand-edit YAML to register a new source, remove an old one, or audit what is currently declared. Hand-editing is error-prone — typos in source names, malformed `includes` entries, ambiguous state values, missing fields, and unintentional schema-version drift all surface only at sync time. Config-editing verbs reuse the same prompts, validators, and idempotency rules that already power init/publish, so the user gets the same guard-rails they had during first-time setup.

## 2. Users & Use Cases

**Primary users:**
- Repository owners maintaining a citadel that pulls from many sources, adding new sources over time as new content streams are identified
- Repository owners maintaining a published document set on a maester, adding documents as new runbooks, ADRs, or specs are written
- Engineers cleaning up obsolete or moved sources/documents that no longer make sense

**Key use cases:**
1. **Add a source to an existing citadel.** A user opens an already-initialized citadel, runs the add verb, walks through the same source-registration prompts as init, and ends with a new entry appended to `citadel.yaml`.
2. **Add a document to an existing maester.** A user in a maester-configured repo runs the publish-add verb and registers an additional document, including state and optional metadata.
3. **Remove a stale entry.** A user removes a source that has been retired (or a document that no longer exists) by picking it from a list of current entries and confirming.
4. **Audit what's currently declared.** A user runs the list verb to see every source / document in the current config, with its key metadata, without opening the YAML file.
5. **Discover edit verbs from the top-level menu.** A user runs `npx baller-maester` in a repo that already has a config and sees the edit verbs offered as menu options instead of the existing "already configured — exit" landing state.

## 3. Scope

**In-scope:**
- An `add` verb for each role that opens the same per-entry wizard used by init/publish and appends a single new entry to the existing config, applying every validator already enforced during initialization (name uniqueness, path shape, URL shape, env-var-name heuristics, destination collision detection)
- A `remove` verb for each role that lists current entries, lets the user pick one by name (citadel sources) or path (maester documents), and removes it after explicit confirmation
- A `list` verb for each role that renders the current entries with their key metadata
- Top-level menu integration: when `npx baller-maester` is run in a repo that already has a citadel or maester config, the menu offers the edit verbs for that role alongside any existing "configured" options
- Direct subcommand surface: `maester add`, `maester remove`, `maester list` operate on the citadel; `maester publish add`, `maester publish remove`, `maester publish list` operate on the maester
- Atomic file writes — failed wizards (cancellation, validation rejection, crash) leave the existing config untouched
- Preservation of the schema/version marker and any top-level fields the verb does not modify (e.g. `baseDir` on the citadel) on every write
- Clear refusal when the relevant config file does not yet exist, pointing the user to the init/publish flow

**Out-of-scope:**
- In-place editing of an existing entry (rename a source, change `includes` on a source, swap a document's category) — deferred to a future iteration
- A non-interactive / flag-driven mode for edit verbs (no `--name`, `--url`, etc.)
- Bulk import or merge from another file
- Cleaning up an on-disk destination directory when a source is removed (sync owns its output)
- Editing top-level fields such as `schemaVersion` or `baseDir` through these verbs
- Recovering from an unparseable existing config (a corrupted YAML file is surfaced as an error, not auto-repaired)
- Re-running one-time bootstrap side effects performed by the init/publish flows (Grand Maester skill installation, `package.json` script wiring, `.gitignore` entries for clone-cache paths) — those are owned by [Citadel Initialization](citadel-initialization.md) and [Maester Configuration](maester-configuration.md) and run only at first-time setup

**Deferred ideas:**
- An `edit` verb that walks the user through changing fields on an existing entry
- Flag-driven non-interactive variants for CI use
- A `move` verb that combines remove + add to relocate or rename an entry
- A diff preview of the pending change before the user confirms the write
- Cleanup of an orphaned destination directory after `remove`

## 4. Capabilities

- [ ] **P0**: User can add a new source to an existing citadel via wizard
  - Running `maester add` (or selecting the menu equivalent) opens the same source-registration prompts used by [Citadel Initialization](citadel-initialization.md), capturing one source at a time
  - Every validator that applied during init applies here (unique name against existing sources, well-formed URL, valid `includes` entries with per-entry state choice, env-var-name heuristic for token auth, destination collision against all existing sources)
  - On confirmation, the new entry is appended to `citadel.yaml`; on cancellation or validation rejection, the file on disk is unchanged
  - If no `citadel.yaml` exists at the cwd, the verb refuses with a clear message pointing the user to `maester init`

- [ ] **P0**: User can add a new published document to an existing maester via wizard
  - Running `maester publish add` (or selecting the menu equivalent) opens the same document-registration prompts used by [Maester Configuration](maester-configuration.md)
  - Path-shape validators and the optional file-existence soft warning apply identically to init
  - Adding a path that already appears in the manifest is rejected with reference to the existing entry
  - On confirmation, the new entry is appended to `maester.yaml`; on cancellation, the file on disk is unchanged
  - If no `maester.yaml` exists at the cwd, the verb refuses with a clear message pointing the user to `maester publish`

- [ ] **P0**: User can remove an entry from either config via guided selection
  - Running `maester remove` shows the current sources by name (with URL and ref as a hint) and lets the user pick exactly one
  - Running `maester publish remove` shows the current documents by path (with category and state as a hint) and lets the user pick exactly one
  - The confirmation prompt restates the entry being removed (full name/path plus any description) before any write occurs
  - On cancellation at any point, the file on disk is unchanged

- [ ] **P0**: User can list current entries in either config without opening the file
  - Running `maester list` renders every source with name, URL, ref (or "default branch"), auth type, destination (default or override), and any tags
  - Running `maester publish list` renders every document with path, category, state, description, and any tags
  - When the relevant config file does not exist, the verb prints a clear "no config found" message pointing to the right init/publish verb and exits non-zero
  - Output is styled through the shared CLI styling layer

- [ ] **P0**: Edit verbs preserve schema version and unrelated top-level fields
  - File writes preserve the existing `schemaVersion` value verbatim
  - File writes preserve any top-level field the verb does not touch (e.g. `baseDir` on the citadel) without modification
  - Existing entries that are not being added or removed are written back with their fields and ordering intact
  - The wizard surfaces a warning when it encounters an unrecognized top-level field rather than dropping it

- [ ] **P0**: Top-level menu in an already-configured repo surfaces edit verbs
  - When `npx baller-maester` runs in a repo with `citadel.yaml`, the menu offers Add Source / Remove Source / List Sources entries for that role
  - When `npx baller-maester` runs in a repo with `maester.yaml`, the menu offers Add Document / Remove Document / List Documents entries for that role
  - When both roles are configured, the menu groups verbs by role with clear labels and offers all six
  - Existing "already configured" landing options (view path, exit) remain available alongside the edit verbs

- [ ] **P1**: Edit verbs are atomic against the file
  - The config file is rewritten in a single atomic operation (write to a temporary file, then rename over the target)
  - A crash, cancellation, or write error mid-wizard never produces a half-written or corrupted YAML file
  - On unexpected error during the write, the original file is preserved on disk and the error is reported to the user with the file path

- [ ] **P1**: Edit verbs produce clear next-step guidance after success
  - After `add`: confirms what was appended (name or path) and points to next steps (e.g. "run `maester sync` to pull the new source")
  - After `remove`: confirms what was removed; when the removed source had a synced destination directory, notes that the on-disk output is not cleaned up automatically
  - After `list`: prints the total entry count and the absolute path of the file
  - Exit code is zero on success and non-zero on user cancellation or error

- [ ] **P1**: Remove refuses to leave the config with zero entries
  - The user cannot remove the last entry from either file via the wizard, because the schema requires at least one
  - When the user attempts to remove the last entry, the verb surfaces a clear message explaining the constraint and suggests either adding a new entry first or deleting the file manually for a full reset

- [ ] **P2**: Comments and key ordering in the existing config are preserved on write where possible
  - Best-effort preservation of human-authored comments and existing key ordering in the file
  - If the underlying YAML serializer cannot preserve a given comment or ordering detail, the loss is silent rather than an error
  - The schema/version marker is always preserved regardless of serializer capability
  - Treat this capability as best-effort, not a hard guarantee

## 5. Dependencies

- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Source-entry prompts and validators are owned there and reused verbatim by the citadel `add` verb. Implementation may require lifting the per-source collection into a reusable unit if it is currently inlined in the init flow.
- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — Document-entry prompts and validators are owned there and reused verbatim by the maester `add` verb.
- **Pretty CLI** ([pretty-cli.md](pretty-cli.md)) — All prompts, selection menus, summaries, and list output render through the shared CLI styling layer.

**External dependencies:** None.

## 6. Assumptions & Risks

**Assumptions:**
- The wizard prompts and validators from init/publish are factored such that the per-entry collection step is reusable independently of the "start a new config" flow, or can be cheaply refactored to be reusable
- The YAML serializer used by the project can parse an existing config, mutate the in-memory structure, and write it back without corrupting unrelated content
- Users are willing to delete a config file manually if they want a fully empty state — the wizard does not need to support an "empty config" terminal state
- The existing config on disk is well-formed YAML conforming to the current schema; a corrupted file is a separate error case, not the edit verbs' responsibility to repair

**Risks:**
- **Lost comments or formatting on round-trip.** Many YAML libraries strip comments on parse. *Mitigation:* expectation is set explicitly as a P2 best-effort capability; a comment-preserving serializer can be selected at implementation time if available without introducing unacceptable cost.
- **Removing a source leaves orphaned files on disk.** The sync output directory of a removed source remains in the working tree. *Mitigation:* surface this in the `remove` success message; on-disk cleanup is out of scope and may be addressed by [Maester Sync](maester-sync.md) later.
- **Hand-edited files contain fields the wizard does not recognize.** A user who hand-edited the file in ways outside the schema may lose those edits on round-trip. *Mitigation:* the wizard preserves unrecognized top-level fields without modification and surfaces a warning when it encounters one.
- **Subcommand naming collisions with future verbs.** Reserving `add` / `remove` / `list` at the top level constrains future CLI grammar. *Mitigation:* these are intuitive defaults; the maester variants are namespaced under `publish` (`maester publish add`) so citadel verbs can remain at the top level without conflict.
- **Confusion between roles when both configs exist.** A user with both files could run `maester add` expecting it to affect the maester. *Mitigation:* the top-level `add` / `remove` / `list` verbs are documented as citadel-only; the menu surface labels each verb by role; first-line output from the verb names the file being modified.

## 7. Success Metrics

- A user can append a new source to an existing citadel in one command, with the same number of prompts and the same validators as the original init flow — and never opens the YAML file in an editor to do so
- A user can remove or list an entry in either config without ever opening the YAML file
- 100% of files written by edit verbs are accepted by [Maester Sync](maester-sync.md) without manual edits, with no schema-version regressions
- Cancellation, validation failure, or write error during any edit verb never modifies the existing config on disk

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
