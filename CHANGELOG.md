# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Dependencies
- Added `@modelcontextprotocol/sdk`, `zod-to-json-schema`, `@iarna/toml` as direct runtime dependencies (per architecture Gaps 34, 38, 39).

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
