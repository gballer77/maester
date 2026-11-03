# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Git submodules in one source.** Sync fetches the submodules a source's `includes`, manifest entries or whole-repository mode reach into, at the commits the parent pins, including nested ones. Same-host submodules reuse the source's credentials. An unreachable submodule is a warning, not a failed source. A submodule's own `maester.yaml` is ignored: the parent governs. Opt out per source with `submodules: false`.
- **Submodule paths in `maester.yaml`.** `publish inventory` lists files inside initialized submodules (marked with `submodule`), and `publish preview` flags entries that reach an uninitialized one (`uninitialized-submodule`).
- **`maester status` shows each fetched submodule's pinned commit,** and sync output counts fetched and skipped submodules.

### Fixed
- **A path source in whole-directory mode no longer lists an initialized submodule's `.git` file.**

## [0.6.1] - 2026-10-30

### Fixed
- **`maester list --json` prints the declared sources** as one object (`{ filePath, baseDir, sources }`). It previously ignored `--json` and printed the table.
- **A refused sensitive glob names the file it would publish** (e.g. `secrets/key.txt`) instead of repeating the glob.

## [0.6.0] - 2026-10-30

### Fixed
- **`maester --version` and the banner report the real package version.** They were hardcoded and showed `0.4.1` in 0.5.0.

### Added
- **AI-aided maester definition (Publisher skill).** `maester skill install --skill publisher` installs instructions that let your coding agent propose `maester.yaml` entries (documents, description, category, tags, state). It works in Claude Code (`.claude/skills/maester-publisher/`), Codex (`.agents/skills/maester-publisher/`), Cursor (`.cursor/rules/maester-publisher.mdc`) and `AGENTS.md` (its own managed region, next to the Grand Maester's). It needs no citadel. The agent grounds itself, shows the full proposal, and writes only what the user approves. maester never calls a model. `maester publish` offers the skill at the end of its walkthrough.
- **`maester publish apply [--from <file>|-] [--create] [--dry-run]`** applies a JSON change set (`add` / `update` / `remove`) to `maester.yaml` atomically. It keeps comments and untouched entries. Guards: `acknowledgeNarrowing` when a whole-repository publish would narrow, `allowSensitive` for paths matching sensitive files, and no removing the last entry. A refused change set exits `2` with `{field, path, message}`.
- **`maester publish update --path …`** and **`--path` modes for `publish add | remove`**: non-interactive one-entry edits with `--description`, `--category`, `--tags`, `--state`, `--unset`, `--acknowledge-narrowing`, `--allow-sensitive` and `--dry-run`. `publish list --json` reports `manifest: none | whole-repository | listed`.
- **`maester publish inventory [--all] [--limit n]`** (read-only): candidate documents respecting `.gitignore` and the built-in excludes, with inline state / category / tags (never content), the covering entry, the vocabulary already in use, a per-directory rollup, and a `sensitive` list of files that are never candidates.
- **`maester publish preview [--from <file>|-]`** (read-only): the files each current or proposed entry publishes, with their effective state / category / tags, resolved by the same code sync uses. Flags `empty-entry` and `redundant` entries and multi-matched files.
- **`maester skill install | upgrade | add-target | status --skill <grand-maester|publisher>`.**
- **`maester connector tools [--servers]`** prints the tool list `maester mcp` would expose (connector tools, linked-document tools when a linked source exists), without starting an MCP session. `--servers` also starts proxied MCP servers to list their tools; `--json` returns a `tools/list`-shaped object.
- **`maester connector refresh --dry-run`** shows, per installed agent host, the env-var names maester would forward and which connector or MCP server needs each, hand-added names that are kept, and direct server entries written or removed. Nothing is written.
- **Config editing verbs.** `maester add | remove | list` edit the sources in `citadel.yaml`, and `maester publish add | remove | list` edit the documents in `maester.yaml`, reusing the init/publish prompts and validators. Edits keep comments, key order, `schemaVersion` and untouched entries, are fully re-validated, and are written atomically. `remove` refuses the last entry. The top-level menu offers these verbs once a config exists. Exit codes: `0` ok, `1` declined, `2` missing/invalid config or refused edit, `130` Ctrl-C.
- **Third-party MCP servers in the citadel (`mcpServers`).** Declare a `local` server (a command maester starts) or a `remote` one (a Streamable HTTP URL) once in `citadel.yaml`. By default `maester mcp` proxies it: its tools appear as `<server>__<tool>` under the existing `maester` entry on every agent host. Credentials are env-var **names** only, forwarded into each host's `maester` registration. Servers start concurrently with a 10 s timeout each; a failing server drops only its own tools and logs a reason (`missing-env-var`, `command-not-found`, `connection-refused`, `auth-failed`, `timeout`, `protocol-error`, `exited`). An optional `tools` allowlist trims what a server exposes.
- **`register: direct`** writes a server as its own maester-managed entry in `.mcp.json`, `.cursor/mcp.json` and `.codex/config.toml`, for servers that need the host's own sign-in. Unmanaged entries with the same name are never touched; Cursor is skipped with a warning for remote servers with `auth`.
- **`maester mcp-server add | remove | list | check`.** `add` shows the exact command or URL before saving; `check` starts each proxied server outside an agent session, lists its tools and the total tool count, and exits 1 when any server fails. `maester init` offers an optional MCP-server step after connectors.
- **Document category and tags.** `category` (one slug) and `tags` (slug list) on `maester.yaml` documents and on enriched citadel `includes` entries are now written inline into every copied file, next to `state`. Inline values in a source file win per field, and the first matching rule that sets a field supplies it otherwise. Invalid inline values warn and fall through. Sync reports a per-source category breakdown and tag roll-up (`categoryBreakdown` / `tagRollup` in `--json`). `--verbose` names each field's source of truth, and inline/rule disagreements are reported as warnings.
- **Local directories as sources (`path:`).** A source can read straight from a directory on this machine: no git, no cache, no network. `mode: link` (default) creates one symlink per file and gitignores the destination; `mode: copy` mirrors only the resolved files, with inline state applied, so it can be committed. `path` accepts repo-relative, absolute, `~/…` and `${ENV_VAR}` forms. The filter set uses the same precedence as git sources. Overlap guards stop a path from reading, or writing into, the citadel's own output.
- **Status for path sources** without any network call: `local-changed` (fingerprint drift), `failed` with `reason: "source-missing"` (directory or linked original gone), and `manifest-changed`. Outcomes carry `kind` and `sourcePath`.
- **`maester init` offers "Git repository or local directory?"** with link/copy choice; copy mode requires `includes` when the directory has no published manifest.
- **MCP tools `citadel__list_linked_documents` / `citadel__read_linked_document`** for agent hosts that will not follow symlinks; registered when a linked destination exists.
- **Grand Maester instructions** now explain linked sources and what a dangling link means.
- **Whole-repository sources.** A git source with no `includes` whose repo has no `maester.yaml` (or one with `documents: []`) now syncs every file instead of failing. The content is **linked, never copied**: the destination holds per-file symlinks into `.maester/cache/<name>/` and is added to `.gitignore` on first sync. Built-in excludes skip VCS, dependency and build directories, binary files, and files over 1 MiB; `maester sync --help` lists them.
- **`excludes` on citadel sources** to narrow a whole-repository source. Ignored with a warning in includes- and manifest-driven modes.
- **Sync output and `--json`** carry `mode`, `filterMode`, `wholeRepoReason`, `fileCount`, `skipped` and `gitignoreEntry`. A source switching from copied to linked gets a `destination-ignored` warning with the `git rm -r --cached` to run.
- **`maester status` shows each source's recorded mode** (`[whole-repository, linked]`), carries `kind` / `mode` / `filterMode` in `--json`, and reports a new `cache-missing` reason when a linked destination's cache is gone.
- **`maester publish` can finish with zero documents** after confirming that this publishes the whole repository; it writes `documents: []` with an explanatory comment.

### Changed
- **HTML and `.txt` inline metadata is a leading block** of `state` / `category` / `tags` lines (comments for HTML), rewritten in that order; previously only a line-1 `state` was recognized. Existing line-1 `state` markers keep working unchanged.
- **`disagreement` warnings in sync `--json` gain a `field`** (`state`, `category` or `tags`).
- **`url` is now optional on citadel sources;** each source declares exactly one of `url` or `path`. `ref`/`auth` are git-only and `mode` is path-only.
- **Provenance marker v2 is a `kind: git | path` union.** Path markers record the declared `sourcePath`, `resolvedPath`, a content `fingerprint`, and `fileCount`.
- **`citadel` and `maester` are reserved connector names,** and connector and MCP server names share one namespace.
- **The Grand Maester connector policy** notes that `<name>__` tools may come from proxied third-party MCP servers.
- **Relative link targets are computed between real paths,** fixing dangling links when an ancestor directory is a symlink (e.g. macOS `/var` → `/private/var`).
- **`maester.yaml` `documents` may be empty or omitted** (treated as whole-repository).
- **`manifest-changed` in status** now also fires when the resolved filter mode changes (e.g. a manifest appears upstream) or a whole-repository source's excludes change.
- **Provenance marker v2** (`.maester-source.json`) records `markerVersion`, `kind`, `mode`, `filterMode` and `excludes`. Older markers are read as copy-mode and upgraded on the next sync.
- `maester init` now explains that skipping `includes` means "use the source's maester.yaml if present, otherwise link the whole repository."

### Removed
- The `MAESTER_MANIFEST_MISSING` sync error — a missing manifest is now whole-repository mode. An invalid manifest still fails with `MAESTER_MANIFEST_INVALID`.

## [0.5.0] - 2026-05-21

### Added
- **Connector env-var seeding into MCP host registrations.** The Codex CLI writer now emits `env_vars = ["NAME", ...]` inside `[mcp_servers.maester]` (Codex's native shell pass-through). The Claude Code writer now emits an `env` block under `mcpServers.maester` with `"NAME": "${NAME:-}"` placeholders (Claude Code's native `${VAR}` expansion; the `:-` empty-default form prevents `.mcp.json` parse failures when a var is unset). Cursor — which has no working config-file pass-through — relies on its parent-process env inheritance instead; the installed Grand Maester Cursor rule now lists the required env-var names so users know what to export in the shell that launches Cursor. Closes the gap where a connector configured with `auth: { type: "token", envVar: "GITLAB_TOKEN" }` failed every tool call with `missing-env-var` even when the user had exported the variable in their shell.
- **Union semantics for the maester block.** The framework owns the set of env-var names derived from `citadel.connectors[*].auth.envVar` and persists a small `_maester_managed_env_vars` (Codex) / `_maesterManagedEnv` (Claude Code) marker so the next refresh can distinguish framework-managed entries (which should be stripped when no connector still references them) from user-added entries (which are preserved verbatim across refreshes). De-duped and stable-sorted so output is byte-identical between refreshes. No env-var values are ever written to any file maester produces — names only.

## [0.4.2] - 2026-05-21

### Changed
- **Codex CLI `.codex/config.toml` `[mcp_servers.maester]` block no longer carries a `cwd` field.** Testing on Codex CLI v0.132 confirmed Codex launches the server correctly without it, so the absolute citadel path is gone and the file is now portable and safe to commit. Touches the writer (`src/core/mcp/registrations/codex.ts`), its unit tests, and the matching `gspec/architecture.md` entries that previously stated the `cwd` field was required.

## [0.4.1] - 2026-05-21

### Fixed
- **Docs and CLI strings now use the correct npm package name.** Every `npx maester ...` invocation has been replaced with `npx baller-maester ...` (or `npx -y baller-maester ...` for automation contexts). `npx` resolves by npm package name and this project publishes as `baller-maester`, so the old form would have failed at the registry. Touches the README, CHANGELOG, every `gspec/` document that named the command, both skill-template content files (freshness-awareness and connector-policy-fallback), the `maester init` outro, the missing-config error messages in the config loader, and the auto-generated `citadel.yaml` / `maester.yaml` header comments.
- **Grand Maester `PreToolUse` hook command is now actually invokable.** The `.claude/settings.json` block installed by `maester skill install` previously embedded `npx maester skill runtime preread`, which would fail npm-side resolution. Updated to `npx -y baller-maester skill runtime preread` (matching the existing MCP-registration convention). The `-y` flag skips npx's first-run confirmation so the hook does not stall Claude Code's tool-call flow.
- **Stale docstrings on the MCP registration writers** for Claude Code and Codex CLI claimed the entry embedded `process.argv[1]` rather than `npx maester`; the code has actually emitted `npx -y baller-maester mcp` since 0.4.0. Rewrote both docstrings to match reality.

## [0.4.0] - 2026-05-21

### Added
- **Traveling Maesters (connectors framework)** — a new `connectors:` array in `citadel.yaml`, sibling to `sources:`, that registers external services as live MCP tools. Maester ships a stdio MCP server (`maester mcp`) built on `@modelcontextprotocol/sdk` that reads the citadel, instantiates every configured connector via the compile-time type registry, and exposes each operation as an MCP tool with a deterministic name (`<connector>__<operation>`, kebab → snake). Per-connector entries declare a `type`, a unique `name`, optional `description`, env-var token auth, and a per-type `config` block; unknown types and per-type config errors are caught at config-load time.
- **GitLab Issues connector** (`type: gitlab-issues`) — first concrete connector type. Two operations exposed as MCP tools: `list-issues` (filters: state, labels, assignee, milestone, search, page, per_page; clamped to GitLab's documented max of 100) and `get-issue` (by project-scoped iid). Per-type config: `host` (HTTPS only, defaults to `https://gitlab.com`), `project` (path or numeric ID — purely numeric values are treated as IDs; paths are URL-encoded). Self-hosted GitLab instances work identically to gitlab.com. Native `fetch` client over `/api/v4`, no SDK dependency. GitLab HTTP outcomes map onto the framework's bounded error-code set (401/403 → `auth-failed` naming the env var, 404 → `remote-error/not-found`, 429 → `remote-error/rate-limited` with `Retry-After`, 5xx → `remote-error/transport`).
- **`maester mcp` CLI verb** — runs the stdio MCP server in the current citadel-bearing repo. Validates `citadel.yaml` at startup (all-or-nothing — no partial tool surface); reroutes the project logger to stderr so stdout stays reserved for JSON-RPC frames; exits cleanly when stdio closes.
- **`maester connector` CLI verb group** — `add` (interactive + non-interactive `--type --name --env-var --config --description` flag form), `remove [name] --yes`, `list`, `refresh` (re-validates `citadel.yaml` and re-runs the per-host MCP registration writer — use after editing `citadel.yaml` by hand), and `exec <name> <operation> [--key value]...` (the framework's P1 fallback dispatch surface for non-MCP agents). All mutating verbs refresh per-host MCP registrations after writing.
- **Per-host MCP registration writers** — `<repo>/.mcp.json` (Claude Code), `<repo>/.cursor/mcp.json` (Cursor), and `<repo>/.codex/config.toml` (Codex CLI) with a managed `maester` entry that other entries are round-tripped around byte-for-byte. Writes are idempotent; running twice produces byte-identical files. Hooked into Grand Maester skill `install`/`upgrade` and `connector add`/`remove`/`refresh` so the tool surface stays in sync with `citadel.yaml`. All three writers emit the standard MCP-ecosystem convention: `command = "npx"`, `args = ["-y", "baller-maester", "mcp"]` — portable across machines and self-updating on the next `npm publish`. The Codex block additionally carries `cwd = "<absolute-citadel-path>"` because Codex spawns MCP subprocesses with `cwd = /` regardless of which config supplied the entry. Codex picks up `<repo>/.codex/config.toml` on projects marked `trust_level = "trusted"` in the user-global config (verified on Codex CLI v0.132).
- **Grand Maester connector policy** — installed Grand Maester artifacts (Claude Code, Codex CLI, Cursor) gain a short fixed policy paragraph about reasoning over connector tool output (live data, cite identifiers, treat as point-in-time, watch the freshness verdict). The Generic `AGENTS.md` target gets a parallel paragraph documenting the fallback CLI. Neither artifact enumerates configured connectors — MCP discovery handles that.
- **Init walkthrough connector step** — `maester init` adds an optional connector-registration loop between source registration and the Grand Maester offer; declining completes init normally with no `connectors` block written.

### Changed
- `ResolvedAuth` (returned by `src/core/auth/resolver.ts`) now carries the env-var name in its `token` variant: `{ type: "token"; value: string; envVar: string }`. Lets downstream consumers — including the GitLab connector's 401/403 path — surface the env-var name in error messages without re-walking the original `AuthRef`. The `delegated` variant is unchanged. Backwards-compatible for anything that only reads `type` or `value`.
- **Dependencies:** added `@modelcontextprotocol/sdk`, `zod-to-json-schema`, `@iarna/toml` as direct runtime dependencies (per architecture Gaps 34, 38, 39).

## [0.3.0] - 2026-05-14

### Added
- **`maester publish` per-document state prompt** — the publish walkthrough now asks per published document for a state choice: `draft`, `canon`, or "file header" (defer to inline state in the file). `draft` / `canon` are persisted as a `state:` field on the document entry in `maester.yaml`; "file header" omits the field so each file's own inline state (or the default `draft`) governs at sync time. Covers both the README.md auto-add path and explicit per-document additions, mirroring the `maester init` prompt added in v0.2.0.

## [0.2.1] - 2026-05-14

### Fixed
- **npm publish provenance** — added `repository`, `bugs`, and `homepage` fields to `package.json` so sigstore provenance validation matches the GitHub repository URL. Without these, `npm publish --provenance` failed with `422 Unprocessable Entity` because `repository.url` defaulted to an empty string.

## [0.2.0] - 2026-05-14

### Added
- **`maester init` per-entry state prompt** — when the user declares an explicit `includes` list during citadel initialization, the walkthrough now asks per entry for a state choice: `draft`, `canon`, or "file header" (defer to inline state in the file). `draft` / `canon` are persisted as the enriched `{ path, state }` object form in `citadel.yaml`; "file header" keeps the bare-string form so each file's own inline state (or the default `draft`) governs at sync time. Manifest-driven sources are unaffected.

## [0.1.0] - 2026-05-13

### Added
- **Pretty CLI** styling layer — themed colors (truecolor → 256 → 16 → no-color downgrade ladder), Unicode glyph catalog with ASCII fallbacks, leveled logger with `--verbose`, `--quiet`, `--json` modes, panel/box rendering (light, heavy, rounded), table rendering, and width-aware breakpoints (tiny / compact / default).
- **Citadel initialization** flow (`maester init`) — interactive walkthrough for registering remote git repositories as sources, with an optional `includes` step per source, secret-guarded env-var-name validation, optional destination overrides, idempotent `.gitignore` updates, and an idempotent `maester:sync` script entry in `package.json` when present.
- **Maester configuration** flow (`maester publish`) — interactive walkthrough that writes a `maester.yaml` publish manifest at the repo root, including optional descriptions, categories, and tags per entry, plus a README.md suggestion when one exists.
- **Maester sync** (`maester sync [names...]`) — single-shot sync of every (or scoped) configured source using partial-clone + sparse-checkout, with per-source progress, atomic destination promotion, `.maester-source.json` provenance markers, destination-clobber guard, and `--json` NDJSON output. Continues past individual source failures; non-zero exit if any failed. Each source is either **manifest-driven** (the remote publishes its own `maester.yaml`) or **includes-driven** (the citadel declares an `includes` list on the source); both modes are processed by the same command. Includes-driven sources emit a `no-matches` warning when their includes resolve to zero files at the resolved ref.
- **CLI banner** — pre-rendered figlet specimen with full + compact variants. Shown only on `--help`, `--version`, and the first-run welcome screen; suppressed below 40 cells and on non-TTY output. Opt-out via `--no-welcome` or `MAESTER_NO_WELCOME=1`.
- **Citadel status** (`maester status [names...]`) — read-only freshness check that reports each configured source as `up-to-date`, `behind`, or `failed` using a three-signal probe (never-synced, remote-ref-advanced, manifest-changed). Behind-aware exit codes (`0` / `1` / `2`), `--json` NDJSON output, and per-source scoping. Reuses sync's auth and provenance machinery without mutating the working tree.
- **Document state tagging** — every materialized citadel file carries an inline `state: draft | canon` declared at the source. Markdown frontmatter, HTML comments, top-level YAML/JSON keys, and first-line `state:` for plain text are all supported. Resolution is inline > matching rule (maester-config or citadel-includes) > default (`draft`). Per-source state breakdown appears in sync output (human + `--json`); a `--verbose` listing names the source-of-truth for each file; an informational warning surfaces when inline state disagrees with a rule.
- **Grand Maester agent skill** — opt-in installer that drops citadel-aware, state-aware, freshness-aware instructions into agent-specific locations: `.claude/skills/grand-maester/SKILL.md` plus a managed `maester` key in `.claude/settings.json` (Claude Code), `AGENTS.md` at the repo root (Codex CLI and a generic-fallback target dedup to the same file), and `.cursor/rules/grand-maester.mdc` (Cursor). Standalone CLI: `maester skill install [--target id]`, `maester skill upgrade [--check]`, `maester skill add-target <id>`, `maester skill status`. Claude Code receives a `PreToolUse` hook that calls `maester skill runtime preread`, which path-scopes to citadel reads and runs `maester status` only when needed, with a debounced cache at `.maester/.skill-cache.json` (TTL configurable via `MAESTER_SKILL_STATUS_TTL`, default 300s). Offered as a recommended opt-in step at the end of citadel-init. Every installed artifact carries an idempotent managed-region marker; upgrades preserve user content outside it.
- **Citadel YAML schema v1** — top-level `sources:` array. Each entry is a `Source`; the optional `includes` field decides the mode.
- **CI/CD** — GitHub Actions `ci.yml` matrix (Node 24 + 22) and `release.yml` tag-triggered `npm publish --provenance` via OIDC.
- Public library exports (`src/index.ts`): `loadCitadelConfig`, `loadMaesterConfig`, `runSync`, schema types (`CitadelConfig`, `Source`, `AuthRef`, `MaesterConfig`, `PublishedDocument`), and typed error classes.

### Changed
- Sync orchestration consolidated into a single `src/core/sources/fetcher.ts` (replacing the previously planned per-kind modules). The fetcher branches internally on whether the source declares an `includes` list.
- **Repo-root detection is now always the current working directory.** `npx baller-maester` (and every subcommand) treats `process.cwd()` as the root unconditionally — the old walk-upward-for-`.git`/`package.json` behavior is removed. `citadel.yaml` and `maester.yaml` always land in the directory where you typed the command, never in an ancestor. An existing config file in an ancestor directory is invisible to the cwd model.
- Top-level `baseDir` field on `citadel.yaml` (optional). When set, every source whose `destination` is unset is surfaced at `<baseDir>/<source-name>/` instead of `citadel/<source-name>/`. Per-source `destination` overrides always win. Omitting `baseDir` is identical to today's behavior — fully backward compatible. The citadel-init walkthrough prompts for it with `citadel` pre-filled and omits the field from the generated YAML when the default is accepted.
