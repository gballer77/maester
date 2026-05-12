# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Pretty CLI** styling layer — themed colors (truecolor → 256 → 16 → no-color downgrade ladder), Unicode glyph catalog with ASCII fallbacks, leveled logger with `--verbose`, `--quiet`, `--json` modes, panel/box rendering (light, heavy, rounded), table rendering, and width-aware breakpoints (tiny / compact / default).
- **Citadel initialization** flow (`maester init`) — interactive walkthrough for registering remote git repositories as maesters, with secret-guarded env-var-name validation, optional destination overrides, idempotent `.gitignore` updates, and an idempotent `maester:sync` script entry in `package.json` when present.
- **Maester configuration** flow (`maester publish`) — interactive walkthrough that writes a `maester.yaml` publish manifest at the repo root, including optional descriptions, categories, and tags per entry, plus a README.md suggestion when one exists.
- **Maester sync** (`maester sync [names...]`) — single-shot sync of all (or scoped) configured sources using partial-clone + sparse-checkout, with per-source progress, atomic destination promotion, `.maester-source.json` provenance markers, destination-clobber guard, and `--json` NDJSON output. Continues past individual source failures; non-zero exit if any failed.
- **CLI banner** — pre-rendered figlet specimen with full + compact variants. Shown only on `--help`, `--version`, and the first-run welcome screen; suppressed below 40 cells and on non-TTY output. Opt-out via `--no-welcome` or `MAESTER_NO_WELCOME=1`.
- **CI/CD** — GitHub Actions `ci.yml` matrix (Node 24 + 22) and `release.yml` tag-triggered `npm publish --provenance` via OIDC.
- Public library exports (`src/index.ts`): `loadCitadelConfig`, `loadMaesterConfig`, `runSync`, schema types, and typed error classes.

### Notes
- All five gspec feature PRDs are 100% delivered.
- 167 tests across 25 files (unit + e2e against fixture bare git repos).
