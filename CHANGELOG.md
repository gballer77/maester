# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Pretty CLI** styling layer — themed colors (truecolor → 256 → 16 → no-color downgrade ladder), Unicode glyph catalog with ASCII fallbacks, leveled logger with `--verbose`, `--quiet`, `--json` modes, panel/box rendering (light, heavy, rounded), table rendering, and width-aware breakpoints (tiny / compact / default).
- **Citadel initialization** flow (`maester init`) — interactive walkthrough for registering remote git repositories as sources, with an optional `includes` step per source, secret-guarded env-var-name validation, optional destination overrides, idempotent `.gitignore` updates, and an idempotent `maester:sync` script entry in `package.json` when present.
- **Maester configuration** flow (`maester publish`) — interactive walkthrough that writes a `maester.yaml` publish manifest at the repo root, including optional descriptions, categories, and tags per entry, plus a README.md suggestion when one exists.
- **Maester sync** (`maester sync [names...]`) — single-shot sync of every (or scoped) configured source using partial-clone + sparse-checkout, with per-source progress, atomic destination promotion, `.maester-source.json` provenance markers, destination-clobber guard, and `--json` NDJSON output. Continues past individual source failures; non-zero exit if any failed. Each source is either **manifest-driven** (the remote publishes its own `maester.yaml`) or **includes-driven** (the citadel declares an `includes` list on the source); both modes are processed by the same command. Includes-driven sources emit a `no-matches` warning when their includes resolve to zero files at the resolved ref.
- **CLI banner** — pre-rendered figlet specimen with full + compact variants. Shown only on `--help`, `--version`, and the first-run welcome screen; suppressed below 40 cells and on non-TTY output. Opt-out via `--no-welcome` or `MAESTER_NO_WELCOME=1`.
- **Citadel YAML schema v1** — top-level `sources:` array. Each entry is a `Source`; the optional `includes` field decides the mode.
- **CI/CD** — GitHub Actions `ci.yml` matrix (Node 24 + 22) and `release.yml` tag-triggered `npm publish --provenance` via OIDC.
- Public library exports (`src/index.ts`): `loadCitadelConfig`, `loadMaesterConfig`, `runSync`, schema types (`CitadelConfig`, `Source`, `AuthRef`, `MaesterConfig`, `PublishedDocument`), and typed error classes.

### Changed
- Sync orchestration consolidated into a single `src/core/sources/fetcher.ts` (replacing the previously planned per-kind modules). The fetcher branches internally on whether the source declares an `includes` list.
- **Repo-root detection is now always the current working directory.** `npx maester` (and every subcommand) treats `process.cwd()` as the root unconditionally — the old walk-upward-for-`.git`/`package.json` behavior is removed. `citadel.yaml` and `maester.yaml` always land in the directory where you typed the command, never in an ancestor. An existing config file in an ancestor directory is invisible to the cwd model.
- Top-level `baseDir` field on `citadel.yaml` (optional). When set, every source whose `destination` is unset is surfaced at `<baseDir>/<source-name>/` instead of `citadel/<source-name>/`. Per-source `destination` overrides always win. Omitting `baseDir` is identical to today's behavior — fully backward compatible. The citadel-init walkthrough prompts for it with `citadel` pre-filled and omits the field from the generated YAML when the default is accepted.
