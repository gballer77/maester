---
spec-version: v1
implementation-order: 2
---

# Citadel Initialization

## 1. Overview

**Feature name:** Citadel Initialization

**Summary:** An interactive flow (reached from the `npx maester` top-level menu) that bootstraps a "citadel" in any repository — the central configuration that declares which remote git repositories this project pulls knowledge from, how their content is filtered, and the auth references and local script needed to sync them. Each declared source is either **manifest-driven** (the remote owns a `maester.yaml` describing what it publishes) or **includes-driven** (the citadel declares an `includes` list directly on the source).

**Problem being solved:** Teams want their local repositories to consume curated content (docs, playbooks, conventions, specs) from one or more shared remote repositories — both repos they own (which can publish a `maester.yaml` manifest) and repos they don't (which cannot). There is no standard, low-friction way to declare those sources, store auth references safely, and wire up a re-runnable sync. Citadel initialization gives every repository a single, version-controllable starting point — the user runs one command, answers a short walkthrough, and ends up with a committed config file plus a working sync script.

## 2. Users & Use Cases

**Primary users:**
- Repository owners / lead developers setting up a project for the first time
- Engineers adding their repository to an organization's content-sharing scheme
- AI-assisted developers who want external knowledge surfaced into their working tree so coding agents can read it

**Key use cases:**
1. **First-time setup in an empty or existing repo.** A developer runs `npx maester` in a project that has no citadel, picks "Initialize a citadel" from the top-level menu, registers one or more sources interactively, and ends with a committed config plus a sync script.
2. **Adding additional sources during init.** During the same walkthrough, the user registers multiple remotes (e.g. `team-docs`, `architecture-playbooks`, `security-standards`) without leaving the prompt.
3. **Idempotent re-run.** A user re-runs `npx maester` on a repo that already has a citadel. The top-level menu detects the existing configuration and offers safe next steps (view, exit, or guided edit) rather than offering to overwrite silently.
4. **Private-repo registration with env-var auth.** A user adds a private source. The walkthrough captures the environment variable name where the token will live (not the token itself), keeping secrets out of the committed config.
5. **Pulling from a repo that does not publish a `maester.yaml`.** A user registers a public third-party repo as a source and, when prompted, declares an `includes` list (e.g. `docs/**/*.md, README.md`) directly during the walkthrough so the citadel owns the filter set.

## 3. Scope

**In-scope:**
- An "Initialize a citadel" entry in the `npx maester` top-level menu, sibling to the maester-configuration entry
- Interactive walkthrough that gathers: confirmation to create a citadel, one or more source entries (name, git URL, ref, optional `includes` list, auth scheme, optional destination override, optional description and tags)
- Writing a citadel configuration file at the repository root
- Scaffolding/installing a local sync script in the repository so `maester sync` can be invoked later
- Detecting an existing citadel and refusing to overwrite without explicit user direction
- Updating `.gitignore` with any paths the citadel should not commit (e.g. local clone cache directory)
- Basic validation of inputs (non-empty name, well-formed URL, unique source names, well-formed `includes` entries)

**Out-of-scope:**
- Performing the actual sync (delivered by [Maester Sync](maester-sync.md))
- The schema of the remote-side `maester.yaml` manifest (owned by [Maester Configuration](maester-configuration.md))
- A non-interactive / flag-driven init mode
- Editing or adding sources to an existing citadel after init (deferred)
- Validating that a remote URL is reachable or that credentials work
- Publishing or distributing the `maester` package itself

**Deferred ideas:**
- `maester add`, `maester remove`, `maester list` verbs for editing a citadel after init
- A non-interactive flag mode for CI bootstrapping (e.g. `maester init --from <file>`)
- Reachability / auth validation during the walkthrough
- Importing source sets from a shareable manifest (similar to a "playbook")

## 4. Capabilities

- [x] **P0**: User can reach the "Initialize a citadel" flow from the `npx maester` top-level menu
  - The top-level menu offers citadel initialization as a clearly labeled option
  - Command is invokable via `npx maester` without prior global install
  - Selecting it from a repo with no existing citadel config opens the initialization walkthrough
  - User who declines exits cleanly without writing any files
  - User who accepts proceeds into the source-registration steps

- [x] **P0**: User can register one or more sources during the walkthrough
  - Walkthrough collects, per source: a short unique name, a git URL, and a ref (with a clear default for "use the remote's default branch")
  - User can add another source or finish at any registration step
  - At least one source is required to complete init; user cannot save an empty source list
  - Duplicate source names are rejected with a clear message before continuing

- [x] **P0**: User can declare an optional `includes` list for a source during registration
  - For each source, the walkthrough offers an optional step to declare a citadel-side `includes` list (paths or globs)
  - Declining keeps the source in manifest-driven mode (the remote's `maester.yaml` governs what gets pulled at sync time)
  - Accepting requires at least one well-formed entry (repo-relative, no leading `/`, no `..` segments); entries are comma- or whitespace-separated
  - The choice is recorded as a non-empty `includes` array on the source entry — or omitted entirely when the user declines

- [x] **P0**: User can attach an auth reference to a private source via an environment-variable name
  - Per-source auth defaults to "none" (public repo)
  - When the user chooses token auth, the walkthrough prompts only for the env-var name (e.g. `MAESTER_DOCS_TOKEN`), never the secret value
  - The env-var name is recorded in the config; no secret is ever written to disk by the walkthrough

- [x] **P0**: User can optionally override the default copy destination for a source
  - Default destination is a per-source subdirectory under a top-level `citadel/` folder at the repository root
  - User can enter a custom relative path during registration
  - Custom paths are normalized (no leading slash, no `..`) and validated as repo-relative
  - The walkthrough rejects a configuration in which two sources resolve to the same destination (including a default-destination source colliding with another source's override)

- [x] **P0**: Init writes a citadel configuration file at the current working directory
  - File is created at a single, predictable path: the directory from which the CLI was invoked (`process.cwd()`). The CLI never walks upward to choose a different directory.
  - File is human-readable and safe to commit (contains no secret values)
  - File contains a schema/version marker so future tooling can migrate it
  - An existing `citadel.yaml` in an ancestor directory of `cwd` is ignored; the new file is created at `cwd` regardless

- [x] **P0**: Init scaffolds a runnable sync script in the repository
  - After init, the user has a clearly documented way to invoke maester-sync locally (e.g. via a scaffolded script file, an npm script entry, or both)
  - The scaffolded sync entrypoint executes against the citadel config produced by init
  - The scaffolding is documented in stdout at the end of the walkthrough so the user knows exactly how to run it

- [x] **P1**: Re-running `npx maester` on a repo that already has a citadel is safe
  - When the user selects "Initialize a citadel" in a repo that already has one, the existing config is detected and never silently overwritten
  - User is shown the current citadel summary (source count, names) and offered safe options (view config path, exit)
  - Re-running in a configured repo never deletes, truncates, or replaces the existing config without explicit confirmation

- [x] **P1**: Init updates `.gitignore` for paths that should not be committed
  - Any local clone-cache or temporary directory the sync script uses is added to `.gitignore` if not already present
  - The committed citadel config file itself is NOT added to `.gitignore`
  - Existing `.gitignore` entries are preserved; only missing lines are appended

- [x] **P1**: User receives clear next-step guidance at the end of init
  - Final stdout includes: where the config was written, how to run the sync, and a reminder to set any env-var tokens referenced in the config
  - Exit code is zero on success and non-zero on user cancellation or error

- [x] **P2**: Init validates basic shape of each entered URL
  - Obvious invalid inputs (empty, missing scheme, contains whitespace) are rejected before the user moves on
  - URL format is checked locally only — no network call is made

## 5. Dependencies

- **Maester Sync** ([maester-sync.md](maester-sync.md)) — init scaffolds the sync entrypoint, but the runtime behavior of sync is defined and delivered by that feature. Init must produce a config file shape that Maester Sync can consume.
- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — Shares the `npx maester` top-level menu entrypoint. The two flows are siblings under that menu; neither depends on the other's runtime behavior.

**External dependencies:**
- A package registry / distribution channel that makes `npx maester` executable without a prior global install
- Local availability of `git` is expected at sync time (init itself does not invoke git)

## 6. Assumptions & Risks

**Assumptions:**
- Every repository has at most one citadel; the citadel lives at the repository root
- The user running init has write permission to the repository working tree
- Secrets are managed by the user's environment (shell, CI, `.env` loaded externally) — the citadel never owns or stores them
- The default `citadel/` destination directory is acceptable as a convention; users who need a different layout will use the per-source destination override (or the top-level `baseDir` field from [Citadel Base Directory](citadel-base-directory.md))
- The repository is initialized with git (or about to be) — the citadel config and sync script are intended to be committed

**Risks:**
- **Secret leakage via misconfiguration.** A user could paste a raw token into the env-var-name prompt by mistake. *Mitigation:* prompt copy must be unambiguous (e.g. "the NAME of an environment variable, not its value"); validate that the entered value does not look like a token (no whitespace + length heuristic) and warn if it does.
- **Conflicting destination paths.** Two sources could be configured to copy into the same destination. *Mitigation:* detect destination collisions during init and refuse to save until resolved.
- **Walkthrough abandonment leaves partial files.** *Mitigation:* the config file is only written once the user reaches the final confirmation; cancelling earlier leaves the working tree untouched.
- **`.gitignore` rewrites annoy users with custom formatting.** *Mitigation:* append only; never reorder or rewrite existing lines.

## 7. Success Metrics

- A user can go from "empty repo" to "valid, committable citadel config + runnable sync entrypoint" in one command and under a minute of interaction
- 100% of generated config files are accepted by Maester Sync without manual edits
- Zero secret values are written to disk by the init flow across all supported auth choices
- Re-running `npx maester` on a configured repo never destroys or silently mutates the existing citadel configuration

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
