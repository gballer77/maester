---
spec-version: v1
---

# Technical Architecture

## 1. Overview

This is a single-package, ESM-only Node.js library that ships a CLI binary. There is no server, no client–server split, and no persistent storage other than the user's filesystem. At runtime the process reads two YAML configuration files at the working directory's repo root, calls out to the user's installed `git` binary to fetch declared remote repositories, copies their content into a managed destination directory, and reports results to the terminal — or exits cleanly if the user is in an interactive setup flow that produces those configuration files.

### Architectural patterns

- **Layered, feature-sliced code organization.** Three explicit layers sit on top of a thin entry-point layer: a presentation layer (`src/ui/`) owns terminal rendering; a domain layer (`src/core/`) owns config, git, sync, and filesystem logic; a CLI layer (`src/cli/`) glues commands to domain operations.
- **Schema-first configuration.** Every persisted artifact is described by a `zod` schema. The loader parses YAML, hands the result to `zod`, and downstream code consumes only the post-parse typed value.
- **Two-binary surface.** The package exposes a single `bin` (`maester`) and a library export (`src/index.ts`) for programmatic consumers. The CLI is a thin caller of the library; nothing in the library uses `process.exit` or terminal primitives directly.
- **Idempotent operations everywhere.** Init refuses to overwrite. Sync writes through a temp staging tree and atomically promotes. `.gitignore` updates append missing lines and never reorder. Repeated invocations produce identical filesystem state.

### System boundaries

- **In-scope.** The published npm package: CLI binary, library exports, schemas, and the embedded sync runner. All code runs in a single Node 24 process.
- **External — required at runtime.** The user's `git` binary (for sync). The npm registry (for distribution).
- **External — planned.** Google Drive API (`googleapis`), Microsoft Graph API (`@microsoft/microsoft-graph-client`), arbitrary HTTP(S) endpoints. Not part of v1.

### How the architecture serves the features

| Feature | Architectural element |
|---|---|
| [Pretty CLI](features/pretty-cli.md) | `src/ui/theme/`, `src/ui/logger.ts`, `src/ui/prompts.ts`, `src/ui/components/`. Every other feature renders exclusively through this layer. |
| [CLI Banner](features/cli-banner.md) | `src/ui/components/banner.ts`. Reads palette tokens from `src/ui/theme/`. Gated on TTY + width + invocation context detected in `src/cli/main.ts`. |
| [Citadel Initialization](features/citadel-initialization.md) | `src/cli/commands/init.ts` (interactive flow) + `src/core/config/` (write + validate citadel.yaml) + `src/core/repo/gitignore.ts`. |
| [Maester Configuration](features/maester-configuration.md) | `src/cli/commands/publish.ts` (interactive flow) + `src/core/config/` (write + validate maester.yaml). No script scaffolding. |
| [Maester Sync](features/maester-sync.md) | `src/cli/commands/sync.ts` calling `src/core/sync/runner.ts`, which dispatches each entry to its `src/core/sources/` fetcher and orchestrates `src/core/git/`, `src/core/auth/`, and `src/core/sync/stage.ts`. |
| [Citadel Ravens](features/citadel-ravens.md) | `ravens` section in `src/schemas/citadel.ts`; raven-registration step in `src/cli/commands/init.ts`; `src/core/sources/raven.ts` — a `SourceFetcher` implementation that uses each entry's citadel-side `includes` list as the sparse-checkout pattern set (skipping the maester-side manifest-discovery step). |
| [Citadel Base Directory](features/citadel-base-directory.md) | Optional top-level `baseDir` field in `src/schemas/citadel.ts`; `src/core/config/paths.ts` exposes a single `defaultDestinationFor(repoRoot, sourceName, baseDir)` chokepoint reused by `src/core/sync/runner.ts`, `src/core/init/finalize.ts`, and the `superRefine` collision check. `baseDir` prompt added to `src/cli/commands/init.ts`. |

---

## 2. Project Structure

### Directory Layout

```
maester/
├── .github/
│   └── workflows/
│       ├── ci.yml                       # Lint + typecheck + test + build on PR/push
│       └── release.yml                  # Tag-triggered: build + npm publish --provenance
├── bin/
│   └── maester.mjs                      # Shim: #!/usr/bin/env node -> compiled CLI entry
├── src/
│   ├── index.ts                         # Public library entrypoint (re-exports types/fns)
│   ├── cli/
│   │   ├── main.ts                      # Commander setup, top-level dispatch, exit handling
│   │   ├── menu.ts                      # `npx maester` interactive top-level menu
│   │   └── commands/
│   │       ├── init.ts                  # Citadel initialization walkthrough
│   │       ├── publish.ts               # Maester (publish manifest) walkthrough
│   │       └── sync.ts                  # Sync runner CLI binding
│   ├── core/                            # Domain logic. No terminal I/O, no process.exit.
│   │   ├── config/
│   │   │   ├── loader.ts                # yaml.parse + zod.parse; structured errors
│   │   │   ├── writer.ts                # Serialize to YAML; preserve comments on rewrite
│   │   │   └── paths.ts                 # Locate citadel.yaml / maester.yaml at repo root
│   │   ├── repo/
│   │   │   ├── root.ts                  # Detect repo root (walk upward for .git/)
│   │   │   └── gitignore.ts             # Idempotent append of missing entries
│   │   ├── git/
│   │   │   └── client.ts                # Typed simple-git facade (clone, fetch, checkout)
│   │   ├── auth/
│   │   │   └── resolver.ts              # Resolve env-var token references at runtime
│   │   ├── sources/                     # Per-kind fetchers; each implements SourceFetcher
│   │   │   ├── fetcher.ts               # SourceFetcher interface + shared FetchContext/FetchedTree types
│   │   │   ├── maester.ts               # Maester fetcher: stage-1 fetches remote maester.yaml; uses its globs
│   │   │   └── raven.ts                 # Raven fetcher: uses citadel-side `includes` directly (no stage-1)
│   │   ├── sync/
│   │   │   ├── runner.ts                # Orchestrate per-source fetch + stage + promote; dispatches by kind
│   │   │   ├── stage.ts                 # Write-to-temp, then rename for atomic promote
│   │   │   └── provenance.ts            # Read/write .maester-source.json marker
│   │   └── errors.ts                    # Tagged error classes (ConfigError, AuthError, ...)
│   ├── schemas/
│   │   ├── citadel.ts                   # zod schema for citadel.yaml + inferred types
│   │   └── maester.ts                   # zod schema for maester.yaml + inferred types
│   ├── ui/
│   │   ├── theme/
│   │   │   ├── tokens.ts                # Color palette tokens (style.md §2)
│   │   │   ├── resolver.ts              # truecolor/256/16/no-color downgrade ladder
│   │   │   ├── glyphs.ts                # Unicode + ASCII fallbacks (style.md §8)
│   │   │   └── detect.ts                # TTY/COLORTERM/NO_COLOR/COLORFGBG detection
│   │   ├── logger.ts                    # consola wrapper honoring --verbose/--quiet/--json
│   │   ├── prompts.ts                   # @clack/prompts adapters with theme colors
│   │   ├── width.ts                     # process.stdout.columns reader + breakpoints
│   │   └── components/
│   │       ├── banner.ts                # figlet-rendered banner (full + compact)
│   │       ├── box.ts                   # boxen wrappers (light + heavy + rounded)
│   │       ├── progress.ts              # cli-progress determinate bar
│   │       ├── spinner.ts               # braille spinner / NO_MOTION fallback
│   │       └── table.ts                 # cli-table3 wrapper for status tables
│   └── package-meta.ts                  # Read version/name from package.json
├── test/
│   ├── fixtures/
│   │   ├── citadel-configs/             # Sample citadel.yaml files for parser tests
│   │   ├── maester-configs/             # Sample maester.yaml files for parser tests
│   │   └── remotes/                     # Local bare git repos used as fake remotes
│   ├── helpers/
│   │   ├── tmp-repo.ts                  # mkdtemp + git init helpers
│   │   └── run-cli.ts                   # Spawn compiled bin in fixture dir; capture stdio
│   ├── e2e/
│   │   ├── init.test.ts                 # End-to-end citadel init flow
│   │   ├── publish.test.ts              # End-to-end maester publish flow
│   │   ├── sync.test.ts                 # End-to-end sync against fixture remotes
│   │   └── banner.test.ts               # Banner present on --help/--version, absent elsewhere
│   └── unit/                            # Mirrors src/ layout; one *.test.ts per module
├── gspec/                               # Living specifications
├── biome.json                           # Biome lint + format config
├── tsconfig.json                        # strict: true + noUncheckedIndexedAccess + exactOptionalPropertyTypes
├── tsup.config.ts                       # Build config: ESM, .d.ts, bundle CLI bin
├── vitest.config.ts                     # Vitest config (sequential E2E pool, parallel unit pool)
├── pnpm-lock.yaml                       # Committed
├── package.json                         # "type": "module", bin: { maester: "bin/maester.mjs" }
├── README.md                            # Project intro + quickstart (practices.md §4)
├── DEPLOYMENT.md                        # Release procedure (practices.md §4)
├── CHANGELOG.md                         # Per-release user-facing changes
└── LICENSE
```

### File Naming Conventions

| Kind | Convention | Example |
|---|---|---|
| TypeScript source | `kebab-case.ts` | `src/core/sync/runner.ts` |
| Test files | `<module>.test.ts` co-located under `test/unit/` or `test/e2e/` mirroring `src/` | `test/unit/core/config/loader.test.ts` |
| Schema files | `<role>.ts` under `src/schemas/` | `src/schemas/citadel.ts` |
| Config files (user-facing) | `<role>.yaml` at repo root | `citadel.yaml`, `maester.yaml` |
| Constants | `UPPER_SNAKE_CASE` | `const MIN_TERMINAL_WIDTH = 40` |
| Type aliases / interfaces | `PascalCase`, no leading `I` | `type CitadelConfig`, `interface SyncResult` |
| Functions, variables | `camelCase` | `loadCitadelConfig`, `syncResult` |

### Key File Locations

| Concern | Path | Notes |
|---|---|---|
| CLI binary entrypoint | `bin/maester.mjs` | Shebang shim; `import('../dist/cli/main.js')`. Listed in `package.json` `bin` field. |
| Library entrypoint | `src/index.ts` | Re-exports stable public API only — schemas, loader functions, sync runner. |
| Citadel config schema | `src/schemas/citadel.ts` | The shape of `citadel.yaml`. |
| Maester manifest schema | `src/schemas/maester.ts` | The shape of `maester.yaml`. |
| Color palette source | `src/ui/theme/tokens.ts` | Mirrors `gspec/style.md` §2 token-for-token. Single source of truth in code. |
| Glyph catalog | `src/ui/theme/glyphs.ts` | Mirrors `gspec/style.md` §8 with ASCII fallbacks. |
| Top-level CLI dispatch | `src/cli/main.ts` | Commander program; routes subcommands and the no-arg interactive menu. |
| Sync orchestrator | `src/core/sync/runner.ts` | One function per maester; aggregates results; never exits the process. |

---

## 3. Data Model

There is no database. The application's "data model" is the set of YAML configuration documents committed to the user's repository plus a small managed cache state. Each document is described by a `zod` schema in `src/schemas/`. Schemas are versioned via a `schemaVersion` field so the loader can migrate older versions forward.

### Entity Relationship Diagram

```mermaid
erDiagram
    CitadelConfig ||--o{ MaesterSource : "registers"
    CitadelConfig ||--o{ RavenSource : "registers"
    MaesterSource ||--o| AuthRef : "uses"
    RavenSource ||--o| AuthRef : "uses"
    MaesterSource ||--o| Destination : "writes to"
    RavenSource ||--o| Destination : "writes to"
    Destination ||--|| ProvenanceMarker : "contains"
    MaesterConfig ||--o{ PublishedDocument : "declares"

    CitadelConfig {
        string schemaVersion "literal: 2"
        string baseDir "optional; default 'citadel'; repo-relative"
        MaesterSource[] maesters "may be empty if ravens non-empty"
        RavenSource[] ravens "may be empty if maesters non-empty"
    }
    MaesterSource {
        string name PK "unique across maesters + ravens"
        string url "https or ssh git remote"
        string ref "branch/tag/sha; default = remote HEAD"
        AuthRef auth "discriminated union"
        string destination "optional override; repo-relative"
    }
    RavenSource {
        string name PK "unique across maesters + ravens"
        string url "https or ssh git remote"
        string ref "branch/tag/sha; default = remote HEAD"
        string[] includes "min 1; sparse-checkout pattern set"
        AuthRef auth "discriminated union"
        string destination "optional override; repo-relative"
        string description "optional; surfaced in verbose output"
        string[] tags "optional; surfaced in verbose output"
    }
    AuthRef {
        enum type "none, token"
        string envVar "required if type=token; never the value"
    }
    Destination {
        string path "default: citadel/<source.name>/"
        bool isManaged "true if marker present or empty"
    }
    ProvenanceMarker {
        string kind "maester or raven"
        string sourceName
        string sourceUrl
        string ref
        string commitSha
        string[] filterSet "globs that produced this tree"
        string syncedAt "ISO 8601"
    }
    MaesterConfig {
        string schemaVersion "literal: 1"
        PublishedDocument[] documents "min 1 in committed file"
    }
    PublishedDocument {
        string path PK "repo-relative file or glob"
        string description "optional"
        string category "optional"
        string[] tags "optional"
    }
```

### Entity Details

#### CitadelConfig (`citadel.yaml` at repo root)

| Field | Type | Constraints |
|---|---|---|
| `schemaVersion` | integer literal | Required. v2 sets `2`. The loader also accepts `schemaVersion: 1` documents and migrates them in memory (see §9 Gap 9). |
| `baseDir` | string | Optional. Repo-relative path used as the parent folder for every entry whose `destination` is unset. Same shape rules as `MaesterSource.destination` (no leading `/`, no `..`, no whitespace-only). When omitted, behavior is identical to a literal value of `"citadel"`. Introduced by [Citadel Base Directory](features/citadel-base-directory.md). |
| `maesters` | `MaesterSource[]` | Optional; defaults to `[]`. |
| `ravens` | `RavenSource[]` | Optional; defaults to `[]`. |

Cross-array invariants (enforced by a Zod `.superRefine` on the parsed document, not by individual field constraints):

- The combined length of `maesters + ravens` must be ≥ 1. An empty citadel is rejected with an error pointing at the citadel root.
- Every name (across both arrays combined) must be unique. A collision reports both colliding entries by name and kind.
- Every resolved destination (`source.destination ?? \`${config.baseDir ?? "citadel"}/${source.name}\``) must be unique across both arrays combined. A collision reports both colliding entries.

`zod` schema: `.strict()` — unknown top-level fields are rejected, surfacing typos as errors. Introduced by [Citadel Initialization](features/citadel-initialization.md); extended by [Citadel Ravens](features/citadel-ravens.md); consumed by [Maester Sync](features/maester-sync.md).

#### MaesterSource (item inside `CitadelConfig.maesters`)

| Field | Type | Constraints |
|---|---|---|
| `name` | string | Required. Slug shape: `^[a-z0-9][a-z0-9-]*$`. Unique across the combined maesters + ravens namespace. |
| `url` | string | Required. Must parse as `https://`, `ssh://`, or `git@host:path` form. No whitespace. |
| `ref` | string | Optional. When absent, the remote's default branch is used at sync time. |
| `auth` | `AuthRef` | Optional; defaults to `{ type: "none" }`. |
| `destination` | string | Optional. Repo-relative path. Validation: no leading `/`, no `..` segments, no symlinks. Default: `<baseDir>/<name>/` (where `baseDir` defaults to `citadel` — see `CitadelConfig.baseDir`). |

Introduced by: [Citadel Initialization](features/citadel-initialization.md). Consumed by: [Maester Sync](features/maester-sync.md) via `src/core/sources/maester.ts`.

#### RavenSource (item inside `CitadelConfig.ravens`)

| Field | Type | Constraints |
|---|---|---|
| `name` | string | Required. Slug shape: `^[a-z0-9][a-z0-9-]*$`. Unique across the combined maesters + ravens namespace. |
| `url` | string | Required. Same shape rules as `MaesterSource.url`. |
| `ref` | string | Optional. When absent, the remote's default branch is used at sync time. |
| `includes` | string[] | **Required.** Length ≥ 1. Each entry is a repo-relative file path or `globby`-syntax glob; same shape validation as `PublishedDocument.path` (no leading `/`, no `..`, no whitespace-only entries). |
| `auth` | `AuthRef` | Optional; defaults to `{ type: "none" }`. Mechanism identical to `MaesterSource`. |
| `destination` | string | Optional. Same shape rules as `MaesterSource.destination`. Default: `<baseDir>/<name>/` (where `baseDir` defaults to `citadel` — see `CitadelConfig.baseDir`). |
| `description` | string | Optional. Free text; surfaced in `--verbose` output alongside the entry name. |
| `tags` | string[] | Optional. Each tag is a slug (`^[a-z0-9][a-z0-9-]*$`). Surfaced in `--verbose` output. |

Introduced by: [Citadel Ravens](features/citadel-ravens.md). Consumed by: [Maester Sync](features/maester-sync.md) via `src/core/sources/raven.ts`.

#### AuthRef

| Field | Type | Constraints |
|---|---|---|
| `type` | `"none" \| "token"` | Required. Discriminator. |
| `envVar` | string | Required iff `type === "token"`. Conventional shape `^[A-Z][A-Z0-9_]*$`. **The variable name is committed; the value is never written to disk.** |

The init walkthrough validates that the entered string looks like an env-var name (uppercase, no whitespace) and surfaces a warning if it resembles a token (length ≥ 32 and no underscores) before saving. See §7.

#### Destination (implicit, computed at sync time)

Not a persisted entity. Computed per entry (maester or raven) as `entry.destination ?? path.join(repoRoot, config.baseDir ?? "citadel", entry.name)`. The single chokepoint is `defaultDestinationFor(repoRoot, sourceName, baseDir)` in `src/core/config/paths.ts`; every caller — sync runner, init finalizer, and the citadel `.superRefine` collision check — threads the parsed `config.baseDir` through this helper rather than hardcoding `"citadel"`. Sync refuses to write into a destination that contains content lacking a `ProvenanceMarker` (see Risk Mitigation in [maester-sync.md](features/maester-sync.md)). The destination uniqueness invariant on `CitadelConfig` (above) prevents two entries — of either kind — from claiming the same path.

Changing `baseDir` after a previous sync is non-destructive: the next run resolves new destinations under the new base and writes there. Any directories left behind under the previous base are not deleted, moved, or warned about — they are the user's responsibility to clean up. The destination-clobber guard is unaffected, because each managed directory carries its own `ProvenanceMarker`; the orphaned ones simply sit dormant.

#### ProvenanceMarker (`.maester-source.json` inside each destination)

| Field | Type | Constraints |
|---|---|---|
| `kind` | `"maester" \| "raven"` | Which kind produced the directory. |
| `sourceName` | string | Matches the entry's `name` in citadel.yaml. |
| `sourceUrl` | string | Redacted (no embedded token). |
| `ref` | string | The ref the source was resolved to. |
| `commitSha` | string | Full 40-char SHA. |
| `filterSet` | string[] | The globs that produced this tree (resolved from a remote `maester.yaml` for maesters; copied from `includes` for ravens). Used on the next run to decide whether the sparse-checkout pattern set needs to change before a re-fetch. |
| `syncedAt` | ISO 8601 string | UTC. |

Written atomically as the last step of a successful per-entry sync. Used by future runs to recognize "this directory is mine" before overwriting and to detect filter-set drift (a raven whose citadel-side `includes` changed between runs). Introduced by [Maester Sync](features/maester-sync.md) (P2 capability — built from day one because the destination-clobber guard needs it); extended by [Citadel Ravens](features/citadel-ravens.md) for `kind` and `filterSet`.

#### MaesterConfig (`maester.yaml` at repo root)

| Field | Type | Constraints |
|---|---|---|
| `schemaVersion` | integer literal | Required. v1 sets `1`. |
| `documents` | `PublishedDocument[]` | Required. Length ≥ 1. Paths unique. |

`zod` schema: `.strict()`. Introduced by [Maester Configuration](features/maester-configuration.md); consumed at sync time by [Maester Sync](features/maester-sync.md) when a remote is itself a maester.

#### PublishedDocument

| Field | Type | Constraints |
|---|---|---|
| `path` | string | Required. Repo-relative file or glob (`globby` syntax). No leading `/`. No `..`. |
| `description` | string | Optional. Free text. |
| `category` | string | Optional. Slug shape. |
| `tags` | string[] | Optional. Each tag is a slug. |

Introduced by: [Maester Configuration](features/maester-configuration.md).

### Relationship Notes

- **No shared entities across roles.** A `CitadelConfig` and `MaesterConfig` can coexist in the same repo (both files at the root) but never reference each other inside the repo — the linkage happens *across* repos at sync time, when a citadel pulls a remote that itself has a `maester.yaml`.
- **Maester and raven names share a single namespace.** `MaesterSource.name` and `RavenSource.name` are uniqueness-checked against each other so the slug can safely be used as a directory name (`citadel/<name>/`), a CLI argument (`maester sync foo bar`), and a result-table key regardless of kind. The same is true of resolved destinations — a maester and a raven cannot claim the same target directory.
- **Schema versioning.** The citadel schema is at v2 (ravens added). The maester schema remains at v1. The loader (`src/core/config/loader.ts`) reads `schemaVersion` first and routes to the matching schema. v1 citadel documents (with a `sources:` field) are accepted and migrated in memory (see §9 Gap 9). Unknown versions are rejected with an error pointing at the upgrade path. Migrations live in `src/core/config/migrations/`. The optional top-level `baseDir` was added to v2 in-place rather than triggering a v3 bump — it is a backward-compatible additive field, and existing v2 documents that omit it continue to validate and behave identically to before.

---

## 4. API Design

**Not applicable.** There is no network API. The application's interface to the outside world is the CLI command surface (described in §6) and the library export surface in `src/index.ts`. The library export shape:

```ts
// src/index.ts
export { loadCitadelConfig, loadMaesterConfig } from "./core/config/loader.js";
export { runSync } from "./core/sync/runner.js";
export type { CitadelConfig, MaesterSource, RavenSource, AuthRef } from "./schemas/citadel.js";
export type { MaesterConfig, PublishedDocument } from "./schemas/maester.js";
export type { SyncResult, SyncOutcome } from "./core/sync/runner.js";
```

Internal modules are not re-exported. Consumers of the library use only what is listed above; everything else is private.

---

## 5. Page & Component Architecture

**Not applicable.** No GUI or web frontend. "Components" in this project are terminal-output patterns; their architecture is described under §6 (Service & Integration) and §2 (Project Structure → `src/ui/components/`). The style guide ([gspec/style.md](style.md) §6) is the visual specification those components implement.

---

## 6. Service & Integration Architecture

### CLI Command Surface

`commander` defines the verb surface. Every command file under `src/cli/commands/` exports a `register(program: Command): void` function that `src/cli/main.ts` calls during boot.

| Invocation | Behavior |
|---|---|
| `maester` (no args, TTY) | Show the top-level interactive menu (§6.1 below). |
| `maester` (no args, non-TTY) | Print `--help` text and exit 0. |
| `maester init` | Run citadel initialization walkthrough directly, skipping the menu. |
| `maester publish` | Run maester (publish manifest) walkthrough directly. |
| `maester sync [names...]` | Run sync. Optional positional names scope the run to a subset. |
| `maester sync --json` | Sync, emitting one JSON object per line; prompt + spinner layers disabled. |
| `maester --help` | Banner + figlet header + command list. |
| `maester --version` | Banner + version string. |

Global flags (defined on the root `Command`): `--verbose`, `--quiet`, `--json`, `--no-color`, `--color`, `--theme=light|dark`, `--clear`.

### 6.1 Top-Level Interactive Menu

The menu lives in `src/cli/menu.ts` and renders only when `process.stdout.isTTY` and no subcommand is supplied.

```
  ▸ Initialize a citadel       (this repo pulls from remote knowledge sources)
    Configure this repo as a maester  (this repo publishes documents)
    Show status                 (summarize configured roles)
    Exit
```

- The menu detects whether `citadel.yaml` and/or `maester.yaml` already exist (see §6.2) and adjusts labels accordingly — for example, the citadel option becomes "View citadel" when a config is already present, dispatching to the read-only summary path instead of the walkthrough.
- The menu is implemented with `@clack/prompts.select()` and styled via the theme tokens in `src/ui/theme/`.

### 6.2 Repository Discovery and Role Detection

`src/core/repo/root.ts` finds the repo root by walking upward from `process.cwd()` for a `.git/` directory or a `package.json`, returning whichever is closer. Both walkthroughs and sync abort early with a structured error if no repo root is found.

`src/core/config/paths.ts` exposes:

```ts
type RepoRoles = { hasCitadel: boolean; hasMaester: boolean };
function detectRoles(repoRoot: string): RepoRoles;
```

The top-level menu, the banner gate, and the init "is this already a citadel?" check all read through `detectRoles`.

### 6.3 Service Layer (Domain Operations)

Each domain operation is a pure function (or a closely-related set of functions) in `src/core/`. They never read or write to stdout/stderr directly; they return structured results that the CLI layer renders via `src/ui/`.

| Service | Module | Responsibility |
|---|---|---|
| Config loader | `src/core/config/loader.ts` | YAML parse → zod validate → typed config. Throws `ConfigError` with file:line:column on failure. |
| Config writer | `src/core/config/writer.ts` | Serialize typed config to YAML; preserve comments on rewrite via `eemeli/yaml` document model. |
| Git client | `src/core/git/client.ts` | Thin typed wrapper over `simple-git`. Exposes `clone`, `fetch`, `resolveRef`, `worktreeCheckout`. Repository paths and refs are passed as discrete arguments — never string-interpolated. |
| Auth resolver | `src/core/auth/resolver.ts` | Given an `AuthRef`, return either `{ type: "delegated" }` or `{ type: "token", value: string }` read from `process.env[authRef.envVar]`. Throws `AuthError` naming the missing variable. Used identically by both source kinds. |
| Source fetchers | `src/core/sources/{fetcher.ts, maester.ts, raven.ts}` | One implementation per source kind behind a shared `SourceFetcher` interface. Each fetcher resolves its filter set (maester: remote `maester.yaml` globs; raven: citadel-side `includes`) and materializes the resulting tree into the cache directory. Returns a `FetchedTree { kind, name, rootDir, commitSha, filterSet, warnings }` that the runner promotes uniformly. |
| Sync runner | `src/core/sync/runner.ts` | For each citadel entry: dispatch to the matching `SourceFetcher` → stage → promote → write provenance marker. Aggregates per-entry results, each labeled with its `kind`. Never throws on a single-entry failure; per-entry failures are returned as `SyncOutcome` values. |
| Staging | `src/core/sync/stage.ts` | Write all output to `<destination>.tmp-<rand>`, then `fs.rename` to the final destination. Old destination is removed under a temp name and unlinked after the rename succeeds. |
| Provenance | `src/core/sync/provenance.ts` | Read/write `.maester-source.json` inside each destination directory. Validates `maesterName` matches before overwriting. |
| Gitignore | `src/core/repo/gitignore.ts` | Append missing entries to `.gitignore`; never reorder or rewrite. Returns the set of lines that were added. |

### 6.4 External Integrations

| Integration | How |
|---|---|
| User's `git` binary | Wrapped by `simple-git` behind `src/core/git/client.ts`. Detected at startup; missing binary produces a clear, actionable error before any other work. |
| npm registry | Publishing target only. No runtime calls. |
| Google Drive / OneDrive / web URLs | Planned. To be added as additional `SourceFetcher` implementations under `src/core/sources/` (alongside `maester.ts` and `raven.ts`). Out of scope for v1. |

### 6.5 Background Jobs / Events

Not applicable. The CLI is a single-shot process. Within a single sync invocation, multiple sources may be fetched in parallel (default concurrency: 4, capped at the number of configured sources) using `Promise.all` with a small concurrency limiter — but there is no queue, scheduler, or daemon.

### 6.6 Sync Run Flow

```mermaid
sequenceDiagram
    actor U as User
    participant CLI as src/cli/commands/sync.ts
    participant Runner as src/core/sync/runner.ts
    participant Loader as src/core/config/loader.ts
    participant Fetcher as src/core/sources/{maester,raven}.ts
    participant Git as src/core/git/client.ts
    participant Stage as src/core/sync/stage.ts
    participant FS as Filesystem

    U->>CLI: maester sync
    CLI->>Loader: loadCitadelConfig(repoRoot)
    Loader-->>CLI: CitadelConfig | throws ConfigError
    CLI->>Runner: runSync(config, { scope, concurrency })
    loop For each entry in maesters + ravens (parallel, bounded)
        Runner->>Fetcher: fetch(ctx)  [dispatched by entry.kind]
        Fetcher->>Git: partial clone / fetch into .maester/cache/<name>/
        alt entry.kind == "maester"
            Fetcher->>FS: stage-1 sparse-checkout maester.yaml
            FS-->>Fetcher: manifest bytes (or absent)
            Fetcher->>Fetcher: parse → filter set (or full-tree fallback)
        else entry.kind == "raven"
            Fetcher->>Fetcher: filter set = citadel-side includes
        end
        Fetcher->>Git: stage-2 sparse-checkout(filter set) + checkout ref
        Git-->>Fetcher: resolved commit SHA + materialized tree
        Fetcher-->>Runner: FetchedTree { kind, name, rootDir, commitSha, filterSet, warnings }
        Runner->>Stage: copy filtered tree to <destination>.tmp-XXXX
        Stage->>FS: write provenance marker (kind + filterSet)
        Stage->>FS: rename(.tmp-XXXX, destination) [atomic]
        Stage-->>Runner: SyncOutcome { kind, added | updated | unchanged | failed }
    end
    Runner-->>CLI: SyncResult { outcomes[] }
    CLI->>U: human-readable summary (grouped by kind) or JSON stream
```

### 6.7 Fetch Strategy (Partial Clone + Sparse Checkout)

Sync never performs a plain `git clone <url>`. A plain clone transfers every blob in every tracked tree at the configured ref — wasteful when the citadel only consumes a small subset and, for maesters, incompatible with the trust model described in [maester-sync.md P1](features/maester-sync.md) (the maester owns its publish surface). Instead, every fetch resolves a **filter set** (a list of paths/globs) and uses partial-clone + sparse-checkout to materialize only the matching files. The two source kinds differ only in **where the filter set comes from**:

| Kind | Filter set source | Stage-1 manifest-discovery step |
|---|---|---|
| Maester | The remote's own `maester.yaml`, fetched first via a manifest-discovery stage. If absent or schema-invalid, the entire tree is materialized (documented fallback). | Required. |
| Raven | The citadel's own `ravens[<name>].includes` list, available immediately from the local config. The empty case is rejected at config-validation time, so the full-tree fallback never applies. | Skipped. |

The strategy is implemented per kind in `src/core/sources/maester.ts` and `src/core/sources/raven.ts`, both behind the `SourceFetcher` interface in `src/core/sources/fetcher.ts`. `src/core/git/client.ts` provides the specific git invocations both fetchers call. `src/core/sync/runner.ts` orchestrates the per-entry stage→promote pipeline.

#### Stage 1 — Filter resolution

The initial clone is identical for both kinds:

```sh
git clone \
  --filter=blob:none \
  --depth=1 \
  --branch <entry.ref>           # omitted when ref is unset; remote HEAD is used
  --no-checkout \
  --sparse \
  <entry.url> .maester/cache/<entry.name>
```

What this transfers from the remote:

- Commit object at the configured ref (one commit).
- Tree objects reachable from that commit.
- **Zero blobs.** `--filter=blob:none` defers blob downloads until a working-tree operation references them.

What happens next depends on the kind.

**Maester fetcher** (`src/core/sources/maester.ts`). Inside the cache directory:

```sh
git sparse-checkout set --no-cone maester.yaml
git checkout <ref>
```

Effect: git lazily downloads exactly one blob — `maester.yaml` from the repo root, if it exists — and writes it to the working tree. Nothing else is materialized. If `maester.yaml` is absent from the tree, the checkout completes with an empty working directory (no error). The fetcher then reads `<cache>/maester.yaml`:

| Outcome | Behavior in Stage 2 |
|---|---|
| File present, parses against the v1 maester schema | The set of `documents[].path` globs becomes the filter set. |
| File present, schema-invalid | Logged as a non-fatal warning; falls back to "no manifest" behavior. |
| File absent | Falls back to "no manifest" behavior. |

"No manifest" behavior = the citadel consumes the full tree, since the maester has not declared a publish surface. This is the documented default in [maester-sync.md P1](features/maester-sync.md).

**Raven fetcher** (`src/core/sources/raven.ts`). The manifest-discovery checkout is skipped entirely — the filter set is `entry.includes`, already validated as non-empty at config-load time. The fetcher proceeds directly to Stage 2 with those globs in hand. No remote `maester.yaml` is fetched, parsed, or consulted, even if one exists on the raven's source repo — ravens are by definition unilateral.

#### Stage 2 — Selective checkout

With the resolved filter set in hand, both kinds run the same selective-checkout pattern:

```sh
git sparse-checkout set --no-cone -- \
  README.md \
  'docs/adr/*.md' \
  'docs/runbooks/**/*.md' \
  docs/api/reference.md \
  CHANGELOG.md

git checkout <ref>
```

Or, when a maester falls back to a full tree:

```sh
git sparse-checkout disable
git checkout <ref>
```

For ravens, the full-tree fallback never applies — `includes` is required and non-empty by schema. Pattern entries are passed as discrete argv elements (never string-interpolated) so glob metacharacters in include paths cannot escape the sparse-checkout flag.

Either way, git fetches only the blobs that match the active checkout patterns. The cache directory's working tree now contains exactly the files that will be copied to the destination.

**Zero-files-matched detection** (P1 in [Citadel Ravens](features/citadel-ravens.md)). After Stage 2 completes, the raven fetcher counts the files materialized in the working tree. A zero count attaches a structured warning (`{ kind: "raven", name, includes, matched: 0 }`) to the returned `FetchedTree`. The runner forwards the warning to the `SyncOutcome` and the output renderer — the run continues, the destination is left in a clean empty state, and exit status is unaffected. The same probe is harmless for maesters but the warning is suppressed there: a maester with zero published files is the maester maintainer's concern, not the citadel operator's.

#### Subsequent runs (cache already populated)

On every run after the first, the cache directory already exists:

```sh
git -C .maester/cache/<entry.name> fetch --depth=1 origin <ref>
git -C .maester/cache/<entry.name> reset --hard FETCH_HEAD
```

Filter-set drift detection is kind-specific:

- **Maester.** If the remote `maester.yaml` is unchanged between runs (compared by blob SHA), Stage 2's sparse pattern set is reused as-is. If it changed, Stage 1's discovery step re-runs against the new tree before Stage 2.
- **Raven.** The filter set lives in the citadel's local config. The fetcher compares the current `entry.includes` against the `filterSet` recorded in the destination's provenance marker. If they differ, Stage 2 re-runs with the new patterns. If they match, the previous sparse pattern set is reused.

An entry of either kind is reported as `unchanged` when the fetched commit SHA matches the SHA recorded in the destination's provenance marker **and** the resolved filter set is unchanged — no blobs are downloaded beyond the manifest, no files are copied, no rename happens.

#### Bandwidth and disk impact

| Scenario | Blob transfer |
|---|---|
| Maester publishes `README.md` only (1 file) | 1 blob — the README — plus tree metadata. |
| Maester publishes 30 files via globs | 30 blobs plus tree metadata. |
| Maester has no `maester.yaml` | Full tree — same as a conventional clone at the configured ref. |
| Raven with `includes: ["docs/**"]` matching 12 files | 12 blobs plus tree metadata. (No manifest fetch for ravens.) |
| Re-sync, remote unchanged, filter set unchanged | 0 blobs. One `git fetch` round-trip that returns "up to date." |

Disk: each entry's cache holds only the materialized files plus git's own metadata. The behavior is identical for both kinds — a raven publishing kilobytes occupies kilobytes, not the full repo size.

#### Fallback for older `git`

Partial clone (`--filter=blob:none`) requires `git ≥ 2.27` (May 2020). `src/core/git/client.ts` probes `git --version` at startup. On older binaries the runner falls back to a conventional `git clone --depth=1 <url>`, logs a `--verbose` notice naming the missing optimization, and proceeds — the trust model and final destination contents are identical for both kinds; only the bandwidth efficiency is lost.

#### Who owns the filter set, and why

It would be technically straightforward to let `citadel.yaml` declare its own `paths:` filter per maester and apply that filter on the citadel side. The architecture deliberately omits this for maesters. The maester is the authority on what it publishes; a citadel-side override would let a citadel operator pull files the maester did not include in its manifest — defeating the publish-surface contract in [maester-configuration.md](features/maester-configuration.md) §3. If a citadel needs a narrower view than a maester offers, that is a conversation to have with the maester's maintainers, not a config toggle.

Ravens deliberately invert this contract. The raven's source has no manifest and no opinion about what it publishes, so the citadel **must** declare what to pull — `includes` is required and authoritative. The trade-off is upkeep: when the raven's source repo restructures, the citadel's `includes` may need to be updated, and the P1 zero-files-matched warning is the architecture's tripwire for that case. That upkeep cost is intrinsic to consuming a source that did not opt into the publish-surface contract; it is not a defect, and there is no design lever that reduces it without giving up the contract itself.

---

## 7. Authentication & Authorization Architecture

The application has no in-process authorization layer. It operates with the invoking user's filesystem permissions and the credentials their environment grants to outbound git operations. The *only* authentication surface is the auth attached to each `MaesterSource` and each `RavenSource` — both use the same `AuthRef` discriminated union, the same env-var resolution path, and the same redaction rules.

### Auth modes

| Mode | When chosen | Mechanism |
|---|---|---|
| Delegated | `auth.type === "none"` (default) | `simple-git` invokes the user's `git`, which uses SSH keys, the credential helper, or `gh auth` already configured on the machine. The application reads no credentials. |
| Env-var token | `auth.type === "token"` and an `envVar` name is set | At sync time, `src/core/auth/resolver.ts` reads `process.env[envVar]`. If present, the value is injected into an HTTPS URL as `https://x-access-token:${value}@host/...` for the duration of one git operation, then dropped. If absent, the source fails with a clear error naming the missing variable and the run continues. |

### Secret handling rules (enforced by code review and tests)

1. The committed config stores at most the **name** of an env var. Token values never appear in any file the application writes.
2. Any string that may contain a token (URLs, error messages, debug logs) is passed through a redactor before reaching `consola` or `stdout`. The redactor replaces the password segment of any `https://user:pass@host/...` URL with `***`.
3. `--json` mode must never serialize an `AuthRef` field other than `{ type, envVar }`. Tests assert this on every sync fixture.
4. No telemetry. No analytics. The CLI makes only the network calls explicitly configured by the user's sources.

### Auth flow (env-var token mode)

```mermaid
sequenceDiagram
    participant Runner as src/core/sync/runner.ts
    participant Resolver as src/core/auth/resolver.ts
    participant Env as process.env
    participant Git as src/core/git/client.ts
    participant Remote as Git remote

    Runner->>Resolver: resolve(source.auth)
    Resolver->>Env: read process.env[source.auth.envVar]
    alt env var present
        Env-->>Resolver: token value
        Resolver-->>Runner: { type: "token", value }
        Runner->>Git: clone(urlWithToken, cacheDir)
        Git->>Remote: HTTPS request with Authorization
        Remote-->>Git: 200 OK + objects
        Git-->>Runner: success
    else env var missing
        Env-->>Resolver: undefined
        Resolver-->>Runner: throws AuthError("MAESTER_DOCS_TOKEN not set")
        Runner->>Runner: mark source as failed; redact urlWithToken from error
    end
```

### Init-time secret guard

The citadel-init walkthrough enforces the "name, not value" rule with both copy and a heuristic:

- The prompt label is unambiguous: *"Enter the **name** of the environment variable (not the token itself)."*
- The validator rejects whitespace, requires `^[A-Z][A-Z0-9_]*$`, and warns when the input looks like a likely token (≥ 32 characters and no underscores). The warning gives the user a chance to back out before saving.

---

## 8. Environment & Configuration

### Environment Variables (consumed by the CLI)

| Variable | Required | Purpose | Example |
|---|---|---|---|
| `<user-defined>` | Conditional | Each maester with `auth.type === "token"` requires the env var whose name appears in its config. Variable names are user-chosen; common form is `MAESTER_<NAME>_TOKEN`. | `MAESTER_DOCS_TOKEN=ghp_xxx` |
| `NO_COLOR` | No | Disables all ANSI color output. Standard convention. | `NO_COLOR=1` |
| `FORCE_COLOR` | No | Forces color output. Standard convention. | `FORCE_COLOR=3` |
| `COLORTERM` | No (auto) | Detected at startup to choose truecolor vs 256-color. | `COLORTERM=truecolor` |
| `COLORFGBG` | No (auto) | Detected at startup to choose dark/light accent. | `COLORFGBG=15;0` |
| `MAESTER_THEME` | No | Override theme detection: `light` or `dark`. | `MAESTER_THEME=light` |
| `MAESTER_NO_MOTION` | No | Replace spinner with static text + elapsed counter. | `MAESTER_NO_MOTION=1` |

**Never** set in the project; **never** read in CI for the project's own pipeline. The published binary is environment-agnostic. The user's runtime supplies what's needed.

### Configuration Files (in user repositories — produced by the CLI)

| Path | Schema | Created by | Consumed by |
|---|---|---|---|
| `<repo-root>/citadel.yaml` | `src/schemas/citadel.ts` | [Citadel Initialization](features/citadel-initialization.md) | [Maester Sync](features/maester-sync.md) |
| `<repo-root>/maester.yaml` | `src/schemas/maester.ts` | [Maester Configuration](features/maester-configuration.md) | [Maester Sync](features/maester-sync.md), when this repo is consumed as a source |
| `<repo-root>/.maester/cache/<name>/` | n/a (managed git clones) | Sync runner | Sync runner |
| `<repo-root>/<resolved-destination>/.maester-source.json` | `src/core/sync/provenance.ts` | Sync runner | Sync runner (destination-clobber guard). `<resolved-destination>` is `entry.destination` if set, otherwise `<baseDir>/<entry.name>/` with `baseDir` defaulting to `citadel`. |
| `<repo-root>/.gitignore` (append-only) | n/a | Citadel init + sync runner | git |

### Example `citadel.yaml`

```yaml
# citadel.yaml
#
# This file declares the remote knowledge sources this repository pulls into
# a local destination directory. Two kinds of sources are supported:
#
#   * maesters — repositories that publish their own `maester.yaml` declaring
#     what they make available. The citadel consumes whatever the maester
#     publishes; the maester owns the publish surface.
#   * ravens — git repositories the citadel pulls from without any manifest
#     on the remote side. The citadel itself declares the `includes` list of
#     paths/globs to materialize. Use ravens for public third-party repos or
#     private repos you have read access to but do not own.
#
# By default, every source is surfaced at `<baseDir>/<source-name>/` from the
# repository root. The optional top-level `baseDir` field below changes that
# parent folder once for every source; when omitted, the default is `citadel`.
# A per-source `destination` always wins over the configured base.
#
# Run `maester sync` (or `npm run maester:sync`) to refresh both kinds in
# one pass. Generated by `npx maester init` and safe to commit. Secret
# values are never stored here — only the names of environment variables
# that hold them.

schemaVersion: 2

# Optional. Parent folder for every source that does not set its own
# `destination` override. Omit (or set to `citadel`) to keep the default.
# Repo-relative path; leading slashes and `..` segments are rejected.
# baseDir: vendor

maesters:
  # Public repository on its default branch.
  # No `auth` block means delegated auth — uses your local git credentials
  # (SSH keys, credential helper, gh auth, etc.). No `ref` means the remote's
  # default branch is used.
  - name: design-system
    url: https://github.com/example-org/design-system.git

  # Public repository pinned to a specific release tag.
  - name: api-contracts
    url: https://github.com/example-org/api-contracts.git
    ref: v2.4.0

  # Private repository fetched over HTTPS with a token. The env-var NAME is
  # committed; the token VALUE lives in your shell, .env loader, or CI secret
  # manager. Sync fails for this entry if MAESTER_PLAYBOOKS_TOKEN is unset,
  # but continues processing the other entries.
  - name: ops-playbooks
    url: https://github.com/example-org/ops-playbooks.git
    ref: main
    auth:
      type: token
      envVar: MAESTER_PLAYBOOKS_TOKEN

  # Private repository over SSH (token auth not applicable). The user's
  # local SSH agent / keys are used by the underlying git binary.
  - name: architecture-notes
    url: git@github.com:example-org/architecture-notes.git
    ref: main

  # A maester with a custom destination override. By default, content is
  # surfaced at `<baseDir>/<name>/`; this one is redirected to `vendor/tokens/`
  # instead, regardless of what `baseDir` is set to. The override is
  # repo-relative; leading slashes and `..` segments are rejected.
  - name: design-tokens
    url: https://github.com/example-org/design-tokens.git
    ref: release/2026.05
    destination: vendor/tokens

ravens:
  # Pull a third-party public repo's docs into citadel/react-docs/.
  # Because the source publishes no maester.yaml, the citadel owns the
  # `includes` list. Update it if the upstream repo restructures — the
  # P1 "no files matched" warning will surface drift on the next sync.
  - name: react-docs
    url: https://github.com/facebook/react.git
    ref: main
    includes:
      - docs/**/*.md
      - README.md
    description: Upstream React documentation snapshot.

  # Pull a private vendor repo you have read access to but do not own.
  # Same env-var-name auth pattern as a private maester.
  - name: vendor-api-spec
    url: https://github.com/example-vendor/api.git
    ref: release/v3
    includes:
      - openapi/**/*.yaml
      - CHANGELOG.md
    auth:
      type: token
      envVar: VENDOR_API_TOKEN
    destination: vendor/api-spec
```

### Example `maester.yaml`

```yaml
# maester.yaml
#
# This file declares the documents this repository publishes to any citadel
# that pulls from it. It is a manifest only — the documents themselves live
# wherever the `path` fields point, and `maester` does not modify them.
#
# Generated by `npx maester publish` and safe to commit.

schemaVersion: 1

documents:
  # The canonical entry-point document. A single file path, no glob.
  - path: README.md
    category: readme
    description: Service overview, local development setup, and ownership.

  # An ADR (architecture decision records) directory exposed via a glob.
  # Consuming citadels surface every matching file at sync time.
  - path: docs/adr/*.md
    category: adr
    description: Architecture decisions made on this service.
    tags:
      - architecture
      - decisions

  # On-call runbooks, recursively.
  - path: docs/runbooks/**/*.md
    category: runbook
    description: On-call procedures and incident playbooks.
    tags:
      - oncall
      - ops

  # API reference. No description; description is optional.
  - path: docs/api/reference.md
    category: api
    tags:
      - public-api

  # A single specific file with no metadata at all — description, category,
  # and tags are all optional.
  - path: CHANGELOG.md
```

### Configuration Files (in this repository — the package itself)

| File | Purpose | Key non-default settings |
|---|---|---|
| `package.json` | Manifest. | `"type": "module"`, `"bin": { "maester": "bin/maester.mjs" }`, `"engines": { "node": ">=24" }`, `"sideEffects": false`. |
| `tsconfig.json` | TypeScript config. | `"target": "ES2023"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"verbatimModuleSyntax": true`. |
| `tsup.config.ts` | Build. | `entry: { index: "src/index.ts", "cli/main": "src/cli/main.ts" }`, `format: ["esm"]`, `dts: true`, `clean: true`, `target: "node24"`. |
| `vitest.config.ts` | Tests. | Two project pools: `unit` (parallel) and `e2e` (sequential). `test.include: ["test/**/*.test.ts"]`. |
| `biome.json` | Lint + format. | `"organizeImports": "on"`, `"linter.rules.recommended": true`, project-specific overrides for `noConsole` (allowed in `src/cli/` and `src/ui/logger.ts` only). |
| `.github/workflows/ci.yml` | Pull-request gate. | Matrix on Node `24.x` and current LTS. Stages: install → biome → typecheck → test → build. |
| `.github/workflows/release.yml` | Tag-triggered publish. | `permissions: id-token: write`. `npm publish --provenance` via OIDC trusted publishing. Creates GitHub Release from tag. |
| `simple-git-hooks` config (in `package.json`) | Pre-commit. | `pre-commit: "pnpm exec biome check --staged && pnpm exec tsc --noEmit"`. |

### Project Setup

```sh
# Prerequisites: Node 24, pnpm 9, git
git clone https://github.com/<org>/maester.git
cd maester
pnpm install
pnpm run build       # tsup
pnpm run test        # vitest
pnpm run lint        # biome check
pnpm run typecheck   # tsc --noEmit

# Try the local CLI against a scratch repo
pnpm link --global
cd /tmp/test-repo
git init
maester
```

`package.json` scripts to define:

| Script | Command |
|---|---|
| `build` | `tsup` |
| `dev` | `tsup --watch` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `lint` | `biome check .` |
| `lint:fix` | `biome check --write .` |
| `typecheck` | `tsc --noEmit` |
| `format` | `biome format --write .` |
| `prepublishOnly` | `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build` |

---

## 9. Technical Gap Analysis

The following gaps were found in the feature PRDs during architecture design. Each resolution below is committed to this document and is the source of truth for the implementing agent.

### Identified Gaps

#### Gap 1 — Config file names

**What's missing.** No PRD names the citadel config file or the maester manifest file. Both are referenced as "the config file at the repository root."

**Why it matters.** Two distinct, non-overlapping names are required by [Maester Configuration P1](features/maester-configuration.md) and by the role-detection logic in §6.2.

**Resolution.** `citadel.yaml` and `maester.yaml`, both at the repository root. (User-confirmed.) Rationale: role-named, short, intuitive, visually distinct.

#### Gap 2 — Sync-script scaffolding mechanism

**What's missing.** [Citadel Initialization P0](features/citadel-initialization.md) says init "scaffolds a runnable sync script" but does not specify the form ("e.g. via a scaffolded script file, an npm script entry, or both").

**Why it matters.** Determines whether init writes additional files, edits the user's `package.json`, or only documents the canonical command.

**Resolution.** (User-confirmed.) Init detects `package.json` at the repo root. When present, init idempotently adds `"maester:sync": "maester sync"` to its `"scripts"` map (or leaves an existing identical entry untouched). Regardless of presence, init's final stdout always prints the canonical command — `npx maester sync` — as a copy-pasteable instruction. No standalone shim script is written.

#### Gap 3 — Local clone-cache location

**What's missing.** [Maester Sync P0](features/maester-sync.md) says "the local fetch storage is treated as managed cache and is not expected to be committed" but does not name the path.

**Why it matters.** Init writes the cache path to `.gitignore` ([Citadel Initialization P1](features/citadel-initialization.md)); sync writes into the cache; tests need to clean it up.

**Resolution.** `.maester/cache/<source-name>/` at the repo root. (User-confirmed.) Init appends `.maester/` to `.gitignore` as a single line — covering both the clone cache and any other future tool state under `.maester/`.

#### Gap 4 — First-run detection for the welcome banner

**What's missing.** [CLI Banner P0](features/cli-banner.md) requires the banner on the "first-run welcome screen" and gives no detection mechanism.

**Why it matters.** Determines whether the CLI writes a state file and whether the banner shows once-per-repo, once-per-user, or every time a fresh repo opens the menu.

**Resolution.** (User-confirmed.) First-run is inferred from configuration presence: the welcome variant of the banner renders when `npx maester` is invoked with no subcommand AND neither `citadel.yaml` nor `maester.yaml` exists at the repo root. Once either file exists, subsequent no-arg invocations show the top-level menu without the welcome variant. The `--help` and `--version` banner is unaffected.

#### Gap 5 — Sync concurrency model

**What's missing.** [Maester Sync P0](features/maester-sync.md) requires per-source isolation (one failure doesn't abort the run) but says nothing about parallelism.

**Why it matters.** Sequential sync is simple but slow for 5–10 sources; unbounded parallelism risks rate-limiting and noisy progress UI.

**Resolution.** Sync runs sources with a default concurrency of 4, capped at `min(sources.length, 4)`. A `--concurrency <n>` flag overrides for users with many fast remotes. Progress UI prints one line per source (each with its own spinner) plus a single aggregate progress bar (§6.7 of the style guide). Recorded here so this is not re-litigated during implementation.

#### Gap 6 — Destination-clobber guard before any sync has run

**What's missing.** [Maester Sync risk mitigation](features/maester-sync.md) says sync "must refuse to write into a destination that contains content it did not previously produce, unless the destination is empty or contains its own provenance marker." The first sync, by definition, has no marker.

**Why it matters.** Without resolution, the first sync would always succeed and the guard would only fire on already-managed destinations — too late to prevent a misconfigured override from clobbering hand-authored files.

**Resolution.** Before writing on the first sync of a destination, the guard checks three conditions and proceeds only if at least one holds: (a) the destination does not exist; (b) the destination exists and is empty; (c) the destination exists and contains a valid `.maester-source.json` whose `maesterName` matches. Otherwise sync fails for that maester with a clear error and instruction to remove the destination or pick a different one.

#### Gap 7 — `maester.yaml` at the remote: discovery and trust

**What's missing.** [Maester Sync P1](features/maester-sync.md) says sync should "honor path filters published by each maester's own configuration in the remote repo" and that "the exact schema of that self-description is owned by a future feature."

**Why it matters.** Implementing P1 requires a path inside the fetched remote where the manifest lives and a behavior when it's absent.

**Resolution.** The remote's `maester.yaml` lives at the root of the resolved tree and is discovered as part of the fetch strategy in §6.7. If present and `zod`-valid against the v1 maester schema, the listed `documents[].path` globs become the sparse-checkout pattern set. If absent, sync materializes the full tree (the documented default). If present but schema-invalid, a non-fatal warning is logged for that source and the run falls back to the full-tree default. See §6.7 for the full fetch sequence and the citadel-cannot-override rationale.

#### Gap 8 — Sync of a non-existent remote ref

**What's missing.** No PRD covers the case where a configured `ref` does not exist on the remote.

**Why it matters.** This is a routine misconfiguration (typoed branch name) that must produce a clear, single-source failure rather than crash the runner.

**Resolution.** `src/core/git/client.ts.resolveRef()` is the single chokepoint; if the ref cannot be resolved, it throws a typed `RefNotFoundError`. The runner catches this and marks the entry as `failed` with the message "ref `<ref>` not found on `<url>`". No other entries are affected. Exit code is non-zero as required by P0. Applies uniformly to maesters and ravens.

#### Gap 9 — Citadel schema field naming and version bump

**What's missing.** The original v1 citadel schema named its single array `sources: MaesterSource[]`. The [Citadel Ravens](features/citadel-ravens.md) PRD frames the new section as "alongside the existing maesters section," implying a rename, and requires older configs to remain readable.

**Why it matters.** Determines the user-facing YAML shape, the schema version number, and the loader's migration logic. A wrong choice here either breaks any pre-release `citadel.yaml` already committed to a user's branch or leaves the YAML permanently asymmetric.

**Resolution.** (User-confirmed.) The v2 schema renames `sources` to `maesters` and adds `ravens` as a second top-level array, giving `maesters:` and `ravens:` as a symmetric pair. New configs always write `schemaVersion: 2`. The loader still accepts `schemaVersion: 1` documents: when it sees `schemaVersion: 1`, it parses against a small `CitadelV1` schema (with `sources` instead of `maesters`) and migrates the result in memory to the v2 shape (`maesters = sources`, `ravens = []`) before the `superRefine` invariants run. The migration is non-destructive — `loadCitadelConfig` returns a v2-shaped object; only `saveCitadelConfig` writes back, and it always writes v2.

#### Gap 10 — Source-kind abstraction

**What's missing.** The original architecture had `src/core/sync/runner.ts` handling the full per-maester fetch pipeline inline. Adding ravens introduces a second kind whose stage-1 step differs, and the architecture's own forward-looking note (Google Drive, OneDrive, web URLs) already anticipated additional kinds.

**Why it matters.** Determines how cleanly the implementing agent can add a new source kind later, and how testable each kind is in isolation.

**Resolution.** (User-confirmed.) Introduce `src/core/sources/` with one module per kind (`maester.ts`, `raven.ts`), both implementing a shared `SourceFetcher` interface defined in `src/core/sources/fetcher.ts`. The interface shape:

```ts
type FetchContext = {
  entry: MaesterSource | RavenSource;
  cacheDir: string;          // .maester/cache/<name>/
  resolveAuth: (auth: AuthRef) => Promise<ResolvedAuth>;
  git: GitClient;
};

type FetchedTree = {
  kind: "maester" | "raven";
  name: string;
  rootDir: string;           // cache working tree path
  commitSha: string;
  filterSet: string[];       // globs that produced this tree
  warnings: FetchWarning[];  // e.g. zero-files-matched, schema-invalid manifest
};

interface SourceFetcher {
  readonly kind: "maester" | "raven";
  fetch(ctx: FetchContext): Promise<FetchedTree>;
}
```

The runner becomes a thin orchestrator: select fetcher by `entry.kind`, call `fetch`, then stage → promote → write provenance. The previously-planned `src/core/sync/filters.ts` is removed — its logic is absorbed into `src/core/sources/maester.ts`, which is the only module that ever reads a remote `maester.yaml`.

#### Gap 11 — Shared namespace and destination collision enforcement

**What's missing.** The PRD requires raven names to be unique within the combined maesters + ravens set, and forbids destination collisions across both kinds. The enforcement point is not specified.

**Why it matters.** Without a single chokepoint, name and destination collisions could pass schema parsing only to surface as confusing failures during sync (overwriting the wrong directory, ambiguous CLI scoping).

**Resolution.** Both invariants are enforced at config-validation time via a Zod `.superRefine` on `CitadelConfig`, before the loader hands a parsed value to any downstream caller. The refinement:

1. Builds the combined entries list (`[...maesters.map(m => ({ kind: "maester", ...m })), ...ravens.map(r => ({ kind: "raven", ...r }))]`).
2. Asserts each `name` appears exactly once. A duplicate reports both colliding entries by name and kind, pointing at the offending YAML lines via Zod's `addIssue`.
3. Asserts each resolved destination (`entry.destination ?? \`${config.baseDir ?? "citadel"}/${entry.name}\``) appears exactly once. A duplicate reports both colliding entries. The refinement reads `config.baseDir` from the parsed document so the collision check operates on the same resolved path that sync will write to.
4. Asserts the combined length is ≥ 1. An empty citadel is rejected.

The init walkthrough runs the same validator before writing the file so collisions are caught at config-time, not sync-time.

#### Gap 12 — Zero-files-matched detection for ravens

**What's missing.** [Citadel Ravens P1](features/citadel-ravens.md) requires a "no files matched includes" warning. The detection point and effect on the run are not specified.

**Why it matters.** Determines whether a drifted raven fails its entry (too noisy — the destination is still in a consistent state), silently produces an empty directory (too quiet — the user can't tell something broke), or warns and continues.

**Resolution.** Detection happens inside `src/core/sources/raven.ts` after Stage 2 completes: the fetcher counts files materialized in the working tree. A zero count attaches a structured `FetchWarning` to the returned `FetchedTree`. The runner forwards the warning to the per-entry `SyncOutcome`, the human-readable renderer (one styled WARN line per warned entry), and the `--json` stream (the warning is a field on the entry's outcome object). Status remains the standard `added/updated/unchanged`; "no files matched" is a warning, not a failure, and exit code is unaffected.

#### Gap 13 — Sparse-checkout pattern shape and validation for ravens

**What's missing.** The raven `includes` field needs a defined glob syntax and a shape validator.

**Why it matters.** Determines what patterns users can write and where invalid patterns are rejected. Inconsistent validation between init and sync would let bad patterns persist past commit.

**Resolution.** `includes` entries use the **same shape and validation** as `PublishedDocument.path` (defined in `src/schemas/maester.ts`): repo-relative, no leading `/`, no `..` segments, no whitespace-only entries, `globby` glob syntax. The shape validator is extracted into a shared `repoRelativePathSchema` in `src/schemas/common.ts` and reused by both schemas. At sync time, the resolved `includes` are passed to `simple-git`'s `sparseCheckout` API as a discrete argv array (never string-interpolated into a shell command), so glob metacharacters in patterns cannot escape the flag.

#### Gap 14 — Raven destinations default to `<baseDir>/<name>/`

**What's missing.** The PRD says ravens land in `<baseDir>/<raven-name>/` by default (where `baseDir` defaults to `citadel`). This is identical to the maester default — worth recording as a single chokepoint rather than letting the implementation accidentally diverge.

**Resolution.** The destination-resolution helper in `src/core/config/paths.ts` is `defaultDestinationFor(repoRoot, sourceName, baseDir)`. It accepts any entry shaped as `{ name: string; destination?: string }` and is reused by both kinds, with the parsed `config.baseDir` (or its `"citadel"` default) threaded through by every caller — sync runner, init finalizer, and the citadel `.superRefine` collision check. The shared-namespace invariant (Gap 11) prevents two entries — even one maester and one raven with the same name — from claiming the same path: the schema rejects them at parse time. There is no per-kind logic.

#### Gap 15 — Configurable citadel base directory

**What's missing.** [Citadel Base Directory](features/citadel-base-directory.md) introduces an optional top-level `baseDir` that changes the parent folder for every entry whose `destination` is unset. The PRD settles the user-facing behavior; this architecture has to commit to where the field lives in the schema, where the resolution happens, and how the change ships without breaking existing configs.

**Why it matters.** Every place the architecture previously hardcoded `"citadel"` — the destination-resolution helper, the `.superRefine` collision check, the init walkthrough's preview text, the example YAML's header comment — now has to read from a single chokepoint instead. Multiple chokepoints would let the resolved path drift between collision-check time and sync time, allowing a config that validates but writes to the wrong place.

**Resolution.** (User-confirmed.)

1. **Schema shape.** `baseDir` is added to `CitadelConfigSchema` (v2) as an optional, repo-relative string with the same shape validation as `MaesterSource.destination` (no leading `/`, no `..`, no whitespace-only). No schema version bump — the field is purely additive, and existing v2 configs that omit it continue to validate and behave identically.
2. **Single chokepoint.** `defaultDestinationFor(repoRoot, sourceName, baseDir)` in `src/core/config/paths.ts` is the only place that computes a default destination. It applies `baseDir ?? "citadel"` internally so callers can pass through whatever the parsed config has without their own `??` fallback. Every caller — `src/core/sync/runner.ts`, `src/core/init/finalize.ts`, and the citadel `.superRefine` — threads the parsed `config.baseDir` through this helper.
3. **Init-time prompt.** The citadel-init walkthrough adds one prompt for the base directory, pre-filled with `citadel` and validated against the same shape rule as the schema. When the user accepts the default, init **omits** the field from the generated YAML — accepting the default produces a config indistinguishable from today's, minimizing the diff against pre-existing projects. When the user enters anything else, init writes the explicit `baseDir:` line.
4. **Non-destructive change.** If the user later edits `baseDir` and re-syncs, the runner writes to the newly-resolved destinations. Directories under the previous base are left in place — no deletion, no move, no warning. The destination-clobber guard remains intact because each managed directory still owns its `ProvenanceMarker`; orphaned ones are inert.
5. **Cache is unaffected.** The `.maester/cache/<source-name>/` layout is orthogonal to `baseDir`. The cache is keyed by source name only.

### Assumptions

- **One repository, one role each.** A repo has at most one `citadel.yaml` and at most one `maester.yaml`. Both can coexist (as confirmed by [Maester Configuration P1](features/maester-configuration.md)); the schemas and tooling assume single-instance per role per repo.
- **No prior tool state to migrate.** This is a greenfield project. The loader supports forward-migration scaffolding but ships with v1 only.
- **Partial clone requires `git ≥ 2.27`.** The fetch strategy in §6.7 uses `--filter=blob:none` + sparse checkout. Older binaries fall back to a conventional `--depth=1` clone with a `--verbose` notice; final destination contents are identical.
- **`citadel/` is a safe default top-level directory.** No PRD prohibits the default. Users with a conflicting `citadel/` directory at their repo root will hit the destination-clobber guard (Gap 6) and be directed to either set the top-level `baseDir` to a different folder (Gap 15) or set per-source `destination` overrides.
- **`--json` output is one JSON object per line (NDJSON).** Implied by [stack.md §9](stack.md). Confirmed here so tests and downstream consumers can rely on it.

---

