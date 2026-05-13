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
- **Citadel ravens** — second class of pull source in `citadel.yaml` alongside maesters. A raven is a git repo the citadel consumes without any cooperation from the source side (no remote `maester.yaml`); the citadel itself declares an `includes` list of paths/globs to materialize. Same `auth.type: "token"` env-var pattern as maesters. The init walkthrough now offers an optional raven-registration step after the maester loop. `maester sync` processes ravens and maesters in one pass and labels each line with `[maester]` or `[raven]`; a structured `no-matches` warning surfaces when a raven's includes resolve to zero files. Provenance markers gain `kind` + `filterSet` so a raven re-checks out when the citadel-side `includes` changes between runs.
- **Citadel YAML schema v2** — top-level fields renamed from `sources:` to `maesters:` (with a new `ravens:` array). The loader still accepts v1 documents (with `sources:`) and migrates them in memory; new configs always write v2.
- **CI/CD** — GitHub Actions `ci.yml` matrix (Node 24 + 22) and `release.yml` tag-triggered `npm publish --provenance` via OIDC.
- Public library exports (`src/index.ts`): `loadCitadelConfig`, `loadMaesterConfig`, `runSync`, schema types (including `RavenSource`), and typed error classes.

### Changed
- Sync orchestration extracted behind a `SourceFetcher` interface in `src/core/sources/` with one module per kind (`maester.ts`, `raven.ts`). The previous `src/core/sync/filters.ts` is removed; its manifest-discovery logic now lives in `sources/maester.ts`.
- Provenance marker (`.maester-source.json`) field shape: `maesterName` is now `sourceName`, with new `kind` and `filterSet` fields. The reader includes a compat shim that normalizes legacy maesterName-only markers and forces a re-check on the next sync.

### Notes
- All six gspec feature PRDs are 100% delivered.
