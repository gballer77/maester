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
| [Maester Sync](features/maester-sync.md) | `src/cli/commands/sync.ts` calling `src/core/sync/runner.ts`, which calls `src/core/sources/fetcher.ts.fetchSource()` for each entry and orchestrates `src/core/git/`, `src/core/auth/`, and `src/core/sync/stage.ts`. The single fetcher branches internally on whether the source has a citadel-side `includes` list (skip remote-manifest discovery) or not (consult the remote's `maester.yaml`). |
| [Citadel Base Directory](features/citadel-base-directory.md) | Optional top-level `baseDir` field in `src/schemas/citadel.ts`; `src/core/config/paths.ts` exposes a single `defaultDestinationFor(repoRoot, sourceName, baseDir)` chokepoint reused by `src/core/sync/runner.ts`, `src/core/init/finalize.ts`, and the `superRefine` collision check. `baseDir` prompt added to `src/cli/commands/init.ts`. |
| [Document State Tagging](features/document-state-tagging.md) | New `src/core/state/` cluster (`schema.ts`, `format.ts`, `markdown.ts`, `html.ts`, `yaml.ts`, `json.ts`, `plaintext.ts`, `applier.ts`). Schema additions: `state` field on `PublishedDocument`, enriched object form (`{ path, state }`) on `Source.includes`. The applier slots into `src/core/sync/runner.ts` between staging and atomic promote — every materialized file in a supported format carries its resolved state inline at the citadel destination. |

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
│   │   ├── sources/
│   │   │   └── fetcher.ts               # Unified source fetcher + FetchContext/FetchedTree types. Branches on entry.includes: when set, uses them directly as the sparse-checkout pattern set; when unset, stage-1 fetches the remote maester.yaml and uses its globs.
│   │   ├── sync/
│   │   │   ├── runner.ts                # Orchestrate per-source fetch + stage + promote
│   │   │   ├── stage.ts                 # Write-to-temp, then rename for atomic promote
│   │   │   └── provenance.ts            # Read/write .maester-source.json marker
│   │   ├── state/                       # Document state tagging (draft/canon)
│   │   │   ├── schema.ts                # State type + parseState() chokepoint
│   │   │   ├── format.ts                # Extension -> (parser, writer) pair
│   │   │   ├── markdown.ts              # YAML frontmatter via gray-matter
│   │   │   ├── html.ts                  # First-line <!-- state: ... --> (before DOCTYPE)
│   │   │   ├── yaml.ts                  # Top-level state: key via eemeli/yaml
│   │   │   ├── json.ts                  # Top-level state property
│   │   │   ├── plaintext.ts             # Line-1 'state: <value>' for .txt
│   │   │   └── applier.ts               # Walk staged dest -> resolve -> write back
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
    CitadelConfig ||--o{ Source : "registers"
    Source ||--o| AuthRef : "uses"
    Source ||--o| Destination : "writes to"
    Destination ||--|| ProvenanceMarker : "contains"
    MaesterConfig ||--o{ PublishedDocument : "declares"

    CitadelConfig {
        string schemaVersion "literal: 1"
        string baseDir "optional; default 'citadel'; repo-relative"
        Source[] sources "length >= 1"
    }
    Source {
        string name PK "unique within citadel"
        string url "https or ssh git remote"
        string ref "branch/tag/sha; default = remote HEAD"
        IncludeEntry[] includes "optional; when set, min 1; bypasses remote manifest"
        AuthRef auth "discriminated union"
        string destination "optional override; repo-relative"
        string description "optional; surfaced in verbose output"
        string[] tags "optional; surfaced in verbose output"
    }
    IncludeEntry {
        string path "repo-relative file or glob"
        enum state "draft, canon; optional"
    }
    AuthRef {
        enum type "none, token"
        string envVar "required if type=token; never the value"
    }
    Destination {
        string path "default: <baseDir>/<source.name>/"
        bool isManaged "true if marker present or empty"
    }
    ProvenanceMarker {
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
        enum state "draft, canon; optional"
    }
```

### Entity Details

#### CitadelConfig (`citadel.yaml` at repo root)

| Field | Type | Constraints |
|---|---|---|
| `schemaVersion` | integer literal | Required. Current version is `1`. |
| `baseDir` | string | Optional. Repo-relative path used as the parent folder for every entry whose `destination` is unset. Same shape rules as `Source.destination` (no leading `/`, no `..`, no whitespace-only). When omitted, behavior is identical to a literal value of `"citadel"`. Introduced by [Citadel Base Directory](features/citadel-base-directory.md). |
| `sources` | `Source[]` | Optional; defaults to `[]`. |

Cross-array invariants (enforced by a Zod `.superRefine` on the parsed document, not by individual field constraints):

- `sources` must contain at least one entry. An empty citadel is rejected with an error pointing at the citadel root.
- Every `name` must be unique within `sources`. A collision reports both colliding entries by name and index.
- Every resolved destination (`source.destination ?? \`${config.baseDir ?? "citadel"}/${source.name}\``) must be unique. A collision reports both colliding entries.

`zod` schema: `.strict()` — unknown top-level fields are rejected, surfacing typos as errors. Introduced by [Citadel Initialization](features/citadel-initialization.md); consumed by [Maester Sync](features/maester-sync.md).

#### Source (item inside `CitadelConfig.sources`)

| Field | Type | Constraints |
|---|---|---|
| `name` | string | Required. Slug shape: `^[a-z0-9][a-z0-9-]*$`. Unique within `sources`. |
| `url` | string | Required. Must parse as `https://`, `ssh://`, `file://`, or `git@host:path` form. No whitespace. |
| `ref` | string | Optional. When absent, the remote's default branch is used at sync time. |
| `includes` | `(string \| IncludeEntry)[]` | Optional. When present, length ≥ 1. Each entry is either a bare string (the path/glob) or an object `{ path: string; state?: "draft" \| "canon" }`. The path uses the same shape validation as `PublishedDocument.path` (no leading `/`, no `..`, no whitespace-only entries; `globby` syntax). The optional `state` is the includes-driven rule-level state applied to files matched by that entry — see [Document State Tagging](features/document-state-tagging.md) and §6.8. When `includes` is set, the citadel owns the filter set and the remote `maester.yaml` is not consulted; when unset, sync looks for a `maester.yaml` manifest on the remote and uses its globs. |
| `auth` | `AuthRef` | Optional; defaults to `{ type: "none" }`. |
| `destination` | string | Optional. Repo-relative path. Validation: no leading `/`, no `..` segments, no symlinks. Default: `<baseDir>/<name>/` (where `baseDir` defaults to `citadel` — see `CitadelConfig.baseDir`). |
| `description` | string | Optional. Free text; surfaced in `--verbose` output alongside the entry name. |
| `tags` | string[] | Optional. Each tag is a slug (`^[a-z0-9][a-z0-9-]*$`). Surfaced in `--verbose` output. |

Introduced by: [Citadel Initialization](features/citadel-initialization.md). Consumed by: [Maester Sync](features/maester-sync.md) via `src/core/sources/fetcher.ts`.

#### AuthRef

| Field | Type | Constraints |
|---|---|---|
| `type` | `"none" \| "token"` | Required. Discriminator. |
| `envVar` | string | Required iff `type === "token"`. Conventional shape `^[A-Z][A-Z0-9_]*$`. **The variable name is committed; the value is never written to disk.** |

The init walkthrough validates that the entered string looks like an env-var name (uppercase, no whitespace) and surfaces a warning if it resembles a token (length ≥ 32 and no underscores) before saving. See §7.

#### Destination (implicit, computed at sync time)

Not a persisted entity. Computed per source as `source.destination ?? path.join(repoRoot, config.baseDir ?? "citadel", source.name)`. The single chokepoint is `defaultDestinationFor(repoRoot, sourceName, baseDir)` in `src/core/config/paths.ts`; every caller — sync runner, init finalizer, and the citadel `.superRefine` collision check — threads the parsed `config.baseDir` through this helper rather than hardcoding `"citadel"`. Sync refuses to write into a destination that contains content lacking a `ProvenanceMarker` (see Risk Mitigation in [maester-sync.md](features/maester-sync.md)). The destination uniqueness invariant on `CitadelConfig` (above) prevents two sources from claiming the same path.

Changing `baseDir` after a previous sync is non-destructive: the next run resolves new destinations under the new base and writes there. Any directories left behind under the previous base are not deleted, moved, or warned about — they are the user's responsibility to clean up. The destination-clobber guard is unaffected, because each managed directory carries its own `ProvenanceMarker`; the orphaned ones simply sit dormant.

#### ProvenanceMarker (`.maester-source.json` inside each destination)

| Field | Type | Constraints |
|---|---|---|
| `sourceName` | string | Matches the entry's `name` in citadel.yaml. |
| `sourceUrl` | string | Redacted (no embedded token). |
| `ref` | string | The ref the source was resolved to. |
| `commitSha` | string | Full 40-char SHA. |
| `filterSet` | string[] | The globs that produced this tree — resolved from a remote `maester.yaml` when no citadel-side `includes` is set, or copied from `source.includes` when it is. Used on the next run to decide whether the sparse-checkout pattern set needs to change before a re-fetch. |
| `syncedAt` | ISO 8601 string | UTC. |

Written atomically as the last step of a successful per-source sync. Used by future runs to recognize "this directory is mine" before overwriting and to detect filter-set drift (an includes-driven source whose `includes` changed between runs). Introduced by [Maester Sync](features/maester-sync.md) (P2 capability — built from day one because the destination-clobber guard needs it).

#### MaesterConfig (`maester.yaml` at repo root)

| Field | Type | Constraints |
|---|---|---|
| `schemaVersion` | integer literal | Required. v1 sets `1`. |
| `documents` | `PublishedDocument[]` | Required. Length ≥ 1. Paths unique. |

`zod` schema: `.strict()`. Introduced by [Maester Configuration](features/maester-configuration.md); consumed at sync time by [Maester Sync](features/maester-sync.md) when a source has no citadel-side `includes` (manifest-driven mode).

#### PublishedDocument

| Field | Type | Constraints |
|---|---|---|
| `path` | string | Required. Repo-relative file or glob (`globby` syntax). No leading `/`. No `..`. |
| `description` | string | Optional. Free text. |
| `category` | string | Optional. Slug shape. |
| `tags` | string[] | Optional. Each tag is a slug. |
| `state` | `"draft" \| "canon"` | Optional. Manifest-driven rule-level state for files matched by this entry — see [Document State Tagging](features/document-state-tagging.md) and §6.8. Unknown values are rejected by the `zod` schema at parse time. |

Introduced by: [Maester Configuration](features/maester-configuration.md). The `state` field is introduced by [Document State Tagging](features/document-state-tagging.md).

### Relationship Notes

- **No shared entities across roles.** A `CitadelConfig` and `MaesterConfig` can coexist in the same repo (both files at the root) but never reference each other inside the repo — the linkage happens *across* repos at sync time, when a citadel pulls a remote that itself has a `maester.yaml`.
- **All source names share a single namespace.** Every entry in `CitadelConfig.sources` has a unique `name`, so the slug can safely be used as a directory name (`citadel/<name>/`), a CLI argument (`maester sync foo bar`), and a result-table key. The same is true of resolved destinations — two sources cannot claim the same target directory.
- **Schema versioning.** Both the citadel schema and the maester (publish manifest) schema are at v1. The loader (`src/core/config/loader.ts`) reads `schemaVersion` first and rejects unknown versions with an error pointing at the upgrade path. The optional top-level `baseDir` is a backward-compatible additive field; configs that omit it continue to validate and behave identically.

---

## 4. API Design

**Not applicable.** There is no network API. The application's interface to the outside world is the CLI command surface (described in §6) and the library export surface in `src/index.ts`. The library export shape:

```ts
// src/index.ts
export { loadCitadelConfig, loadMaesterConfig } from "./core/config/loader.js";
export { runSync } from "./core/sync/runner.js";
export type { CitadelConfig, Source, AuthRef } from "./schemas/citadel.js";
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

The repo root is always **`process.cwd()`** — the directory the user invoked the CLI from. `src/core/repo/root.ts` exposes `getRepoRoot(start = process.cwd())` which returns `{ path, hasGit, hasPackageJson }` describing what is (or isn't) present at that exact directory. It never walks upward and never returns `undefined`. The walk-up behavior was removed because it surprised users by writing `citadel.yaml` into an unintended ancestor directory when a stray `.git/` or `package.json` lived above the project they were actually working in. The cwd model is predictable: the file lands where you typed the command, full stop.

`hasGit` and `hasPackageJson` are still surfaced because some downstream behavior depends on them (e.g. init wires `maester:sync` into `package.json` when present; without one it prints `no-package-json` instead). Neither marker is required for any command to run — the CLI does not refuse to operate on a directory that lacks them.

`src/core/config/paths.ts` exposes:

```ts
type RepoRoles = { hasCitadel: boolean; hasMaester: boolean };
function detectRoles(repoRoot: string): RepoRoles;
```

The top-level menu, the banner gate, and the init "is this already a citadel?" check all read through `detectRoles` against the cwd-resolved path. An existing `citadel.yaml` in an ancestor directory is invisible to the cwd model — by design.

### 6.3 Service Layer (Domain Operations)

Each domain operation is a pure function (or a closely-related set of functions) in `src/core/`. They never read or write to stdout/stderr directly; they return structured results that the CLI layer renders via `src/ui/`.

| Service | Module | Responsibility |
|---|---|---|
| Config loader | `src/core/config/loader.ts` | YAML parse → zod validate → typed config. Throws `ConfigError` with file:line:column on failure. |
| Config writer | `src/core/config/writer.ts` | Serialize typed config to YAML; preserve comments on rewrite via `eemeli/yaml` document model. |
| Git client | `src/core/git/client.ts` | Thin typed wrapper over `simple-git`. Exposes `clone`, `fetch`, `resolveRef`, `worktreeCheckout`. Repository paths and refs are passed as discrete arguments — never string-interpolated. |
| Auth resolver | `src/core/auth/resolver.ts` | Given an `AuthRef`, return either `{ type: "delegated" }` or `{ type: "token", value: string }` read from `process.env[authRef.envVar]`. Throws `AuthError` naming the missing variable. |
| Source fetcher | `src/core/sources/fetcher.ts` | A single `fetchSource(entry, ctx)` function that resolves a `FetchedTree { name, cacheDir, commitSha, filterSet, warnings }`. Branches internally on whether the source has `includes`: when set, uses them directly as the sparse-checkout pattern set; when unset, performs a manifest-discovery step against the remote's `maester.yaml` and uses its globs (failing the entry if absent or schema-invalid). |
| Sync runner | `src/core/sync/runner.ts` | For each source: call `fetchSource` → stage → promote → write provenance marker. Aggregates per-source results. Never throws on a single-source failure; per-source failures are returned as `SyncOutcome` values. |
| Staging | `src/core/sync/stage.ts` | Write all output to `<destination>.tmp-<rand>`, then `fs.rename` to the final destination. Old destination is removed under a temp name and unlinked after the rename succeeds. |
| Provenance | `src/core/sync/provenance.ts` | Read/write `.maester-source.json` inside each destination directory. Validates `maesterName` matches before overwriting. |
| State applier | `src/core/state/applier.ts` | Walk a staged destination tree, resolve each file's state via the inline > rule > default precedence, and write it back through the format-specific writer. Returns a `{ canon, draft, untagged }` breakdown plus per-file warnings. See §6.8. |
| State format dispatch | `src/core/state/format.ts` | Map a file extension to a `(parser, writer)` pair. Supported in v1: `.md`, `.html` / `.htm`, `.yaml` / `.yml`, `.json`, `.txt`. Unsupported extensions return `undefined` (the file is counted as untagged and no inline state is written). |
| Gitignore | `src/core/repo/gitignore.ts` | Append missing entries to `.gitignore`; never reorder or rewrite. Returns the set of lines that were added. |

### 6.4 External Integrations

| Integration | How |
|---|---|
| User's `git` binary | Wrapped by `simple-git` behind `src/core/git/client.ts`. Detected at startup; missing binary produces a clear, actionable error before any other work. |
| npm registry | Publishing target only. No runtime calls. |
| Google Drive / OneDrive / web URLs | Planned. To be added as additional fetcher implementations alongside `src/core/sources/fetcher.ts`. Out of scope for v1. |

### 6.5 Background Jobs / Events

Not applicable. The CLI is a single-shot process. Within a single sync invocation, multiple sources may be fetched in parallel (default concurrency: 4, capped at the number of configured sources) using `Promise.all` with a small concurrency limiter — but there is no queue, scheduler, or daemon.

### 6.6 Sync Run Flow

```mermaid
sequenceDiagram
    actor U as User
    participant CLI as src/cli/commands/sync.ts
    participant Runner as src/core/sync/runner.ts
    participant Loader as src/core/config/loader.ts
    participant Fetcher as src/core/sources/fetcher.ts
    participant Git as src/core/git/client.ts
    participant Stage as src/core/sync/stage.ts
    participant Applier as src/core/state/applier.ts
    participant FS as Filesystem

    U->>CLI: maester sync
    CLI->>Loader: loadCitadelConfig(repoRoot)
    Loader-->>CLI: CitadelConfig | throws ConfigError
    CLI->>Runner: runSync(config, { scope, concurrency })
    loop For each source (parallel, bounded)
        Runner->>Fetcher: fetchSource(entry, ctx)
        Fetcher->>Git: partial clone / fetch into .maester/cache/<name>/
        alt entry.includes is set
            Fetcher->>Fetcher: filter set = entry.includes
        else
            Fetcher->>FS: stage-1 sparse-checkout maester.yaml
            FS-->>Fetcher: manifest bytes (or absent)
            Fetcher->>Fetcher: parse → filter set (fails the entry when absent or invalid)
        end
        Fetcher->>Git: stage-2 sparse-checkout(filter set) + checkout ref
        Git-->>Fetcher: resolved commit SHA + materialized tree
        Fetcher-->>Runner: FetchedTree { name, cacheDir, commitSha, filterSet, warnings }
        Runner->>Stage: copy filtered tree to <destination>.tmp-XXXX
        Stage->>Applier: applyState(stagedDir, filterSet)
        Applier->>FS: read each file, resolve state, write inline tag (or skip if byte-identical)
        Applier-->>Stage: { canon, draft, untagged } + warnings
        Stage->>FS: write provenance marker (filterSet)
        Stage->>FS: rename(.tmp-XXXX, destination) [atomic]
        Stage-->>Runner: SyncOutcome { added | updated | unchanged | failed, stateBreakdown, warnings }
    end
    Runner-->>CLI: SyncResult { outcomes[] }
    CLI->>U: human-readable summary or JSON stream
```

### 6.7 Fetch Strategy (Partial Clone + Sparse Checkout)

Sync never performs a plain `git clone <url>`. A plain clone transfers every blob in every tracked tree at the configured ref — wasteful when the citadel only consumes a small subset and, in the manifest-driven mode, incompatible with the trust model described in [maester-sync.md P1](features/maester-sync.md) (the remote owns its publish surface). Instead, every fetch resolves a **filter set** (a list of paths/globs) and uses partial-clone + sparse-checkout to materialize only the matching files. The two source modes differ only in **where the filter set comes from**:

| Mode | Trigger | Filter set source | Stage-1 manifest-discovery step |
|---|---|---|---|
| Manifest-driven | `source.includes` is unset | The remote's own `maester.yaml`, fetched first via a manifest-discovery stage. If absent or schema-invalid, the entry is failed — sync never falls back to a full tree. | Required. |
| Includes-driven | `source.includes` is set (length ≥ 1) | The citadel's own `source.includes` list, available immediately from the local config. The empty case is rejected at config-validation time. | Skipped. |

Both modes are implemented in `src/core/sources/fetcher.ts` (a single `fetchSource()` function with two branches). `src/core/git/client.ts` provides the specific git invocations the fetcher calls. `src/core/sync/runner.ts` orchestrates the per-source stage→promote pipeline.

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
| File present, schema-invalid | The entry fails with a `MAESTER_MANIFEST_INVALID` error. No Stage 2 occurs; other sources continue. |
| File absent | The entry fails with a `MAESTER_MANIFEST_MISSING` error. No Stage 2 occurs; other sources continue. |

A manifest-driven source whose remote does not publish a `maester.yaml` is treated as a configuration error rather than a "pull everything" signal — the contract is that the remote owns the publish surface, so an unspecified surface has no defined behavior. Consumers who want unfiltered content from such a source must add an `includes` list on the citadel side (switching the source to includes-driven mode). See [maester-sync.md P1](features/maester-sync.md).

**Includes-driven branch.** When `entry.includes` is set, the manifest-discovery checkout is skipped entirely — the filter set is `entry.includes`, already validated as non-empty at config-load time. The fetcher proceeds directly to Stage 2 with those globs in hand. No remote `maester.yaml` is fetched, parsed, or consulted, even if one exists on the source repo — declaring `includes` is the citadel's way of taking authority over the filter set.

#### Stage 2 — Selective checkout

With the resolved filter set in hand, both modes run the same selective-checkout pattern:

```sh
git sparse-checkout set --no-cone -- \
  README.md \
  'docs/adr/*.md' \
  'docs/runbooks/**/*.md' \
  docs/api/reference.md \
  CHANGELOG.md

git checkout <ref>
```

Pattern entries are passed as discrete argv elements (never string-interpolated) so glob metacharacters in include paths cannot escape the sparse-checkout flag. There is no full-tree code path: manifest-driven sources without a remote manifest fail in Stage 1, and includes-driven sources always have a non-empty `includes` list by schema.

Either way, git fetches only the blobs that match the active checkout patterns. The cache directory's working tree now contains exactly the files that will be copied to the destination.

**Zero-files-matched detection** (P1 in [Maester Sync](features/maester-sync.md)). After Stage 2 completes for an includes-driven source, the fetcher counts the files materialized in the working tree. A zero count attaches a structured warning (`{ type: "no-matches", name, includes }`) to the returned `FetchedTree`. The runner forwards the warning to the `SyncOutcome` and the output renderer — the run continues, the destination is left in a clean empty state, and exit status is unaffected. The probe is suppressed for manifest-driven sources: a source repo whose `maester.yaml` publishes zero matching files is the source maintainer's concern, not the citadel operator's.

#### Subsequent runs (cache already populated)

On every run after the first, the cache directory already exists:

```sh
git -C .maester/cache/<entry.name> fetch --depth=1 origin <ref>
git -C .maester/cache/<entry.name> reset --hard FETCH_HEAD
```

Filter-set drift detection depends on the source mode:

- **Manifest-driven.** If the remote `maester.yaml` is unchanged between runs (compared by blob SHA), Stage 2's sparse pattern set is reused as-is. If it changed, Stage 1's discovery step re-runs against the new tree before Stage 2.
- **Includes-driven.** The filter set lives in the citadel's local config. The fetcher compares the current `source.includes` against the `filterSet` recorded in the destination's provenance marker. If they differ, Stage 2 re-runs with the new patterns. If they match, the previous sparse pattern set is reused.

A source is reported as `unchanged` when the fetched commit SHA matches the SHA recorded in the destination's provenance marker **and** the resolved filter set is unchanged — no blobs are downloaded beyond the manifest, no files are copied, no rename happens.

#### Bandwidth and disk impact

| Scenario | Blob transfer |
|---|---|
| Manifest-driven source publishes `README.md` only (1 file) | 1 blob — the README — plus tree metadata. |
| Manifest-driven source publishes 30 files via globs | 30 blobs plus tree metadata. |
| Manifest-driven source with no remote `maester.yaml` | Stage 1 fails the source; no destination is written. |
| Includes-driven source with `includes: ["docs/**"]` matching 12 files | 12 blobs plus tree metadata. (No manifest fetch — Stage 1 is skipped.) |
| Re-sync, remote unchanged, filter set unchanged | 0 blobs. One `git fetch` round-trip that returns "up to date." |

Disk: each source's cache holds only the materialized files plus git's own metadata — a source publishing kilobytes occupies kilobytes, not the full repo size.

#### Fallback for older `git`

Partial clone (`--filter=blob:none`) requires `git ≥ 2.27` (May 2020). `src/core/git/client.ts` probes `git --version` at startup. On older binaries the runner falls back to a conventional `git clone --depth=1 <url>`, logs a `--verbose` notice naming the missing optimization, and proceeds — the trust model and final destination contents are identical; only the bandwidth efficiency is lost.

#### Who owns the filter set, and why

It would be technically straightforward to let `citadel.yaml` always override the remote's `maester.yaml` with its own `paths:` filter. The architecture deliberately does not allow that *layering*: when a source is manifest-driven (no citadel-side `includes`), the remote is the sole authority on what it publishes. A citadel-side override on top of the manifest would let a citadel operator pull files the remote did not include — defeating the publish-surface contract in [maester-configuration.md](features/maester-configuration.md) §3. If a citadel needs a narrower view than a manifest offers, that is a conversation to have with the source repo's maintainers, not a config toggle.

The includes-driven mode deliberately inverts this contract: the source has no manifest and no opinion about what it publishes, so the citadel **must** declare what to pull — `includes` is authoritative and `maester.yaml` (if any) is ignored. The trade-off is upkeep: when the source repo restructures, the citadel's `includes` may need to be updated, and the P1 zero-files-matched warning is the architecture's tripwire for that case. That upkeep cost is intrinsic to consuming a source that did not opt into the publish-surface contract; it is not a defect, and there is no design lever that reduces it without giving up the contract itself.

### 6.8 Document State Tagging

[Document State Tagging](features/document-state-tagging.md) introduces a per-file `state` (`"draft"` or `"canon"`) that is resolved at sync time and materialized **inline** in every supported file at the citadel destination. The architecture implements it as a single resolve-then-apply pass over the staged tree, inserted between the sparse-checkout copy and the atomic promote in §6.6. The state-tagging surface never touches the original maester sources — only the citadel's staged copy is rewritten.

#### Module placement

| Module | Responsibility |
|---|---|
| `src/core/state/schema.ts` | The `State = "draft" \| "canon"` type and a `parseState(value: unknown): State \| undefined` chokepoint used by both config schemas and the inline parsers. The default state constant (`"draft"`) lives here as well so every site references the same literal. |
| `src/core/state/format.ts` | Maps a file extension to a `{ parse, write }` pair. v1 dispatch: `.md` → markdown, `.html`/`.htm` → html, `.yaml`/`.yml` → yaml, `.json` → json, `.txt` → plaintext. Anything else returns `undefined`; the file is counted as `untagged` and no inline state is written. |
| `src/core/state/markdown.ts` | YAML-frontmatter via [`gray-matter`](https://github.com/jonschlinkert/gray-matter). Read returns `{ state }` from `matter(data).data.state`. Write mutates the data object and re-stringifies via `matter.stringify(body, data)`, which round-trips existing frontmatter; when no frontmatter exists, gray-matter prepends a fresh `---\nstate: <value>\n---\n` block. |
| `src/core/state/html.ts` | First-line HTML comment of the form `<!-- state: <value> -->`. Written **before** any `<!DOCTYPE>` directive — mirroring this project's own `gspec/style.html` `<!-- spec-version: v1 -->` convention. Detection regex against line 1: `^<!--\s*state:\s*(draft\|canon)\s*-->$`. Replace if matched; otherwise prepend the comment + newline. |
| `src/core/state/yaml.ts` | Top-level `state:` key via `eemeli/yaml` document model (comment-preserving). Read: `doc.get("state")`. Write: `doc.set("state", value)`, then `doc.toString()`. When the document is a top-level array or scalar (i.e. not a mapping), the file is treated as unsupported — no error, no write. |
| `src/core/state/json.ts` | Top-level `state` property. Read uses `JSON.parse`. Write re-serializes via `JSON.stringify(obj, null, indent)` where `indent` is inferred from the source (preserves a 2-space file as 2-space). When the document is a top-level array or non-object, the file is treated as unsupported. |
| `src/core/state/plaintext.ts` | A single first line of the form `state: <value>` (case-sensitive). Detection regex against line 1: `^state:\s+(draft\|canon)\s*$`. Replace if matched; otherwise prepend. |
| `src/core/state/applier.ts` | Top-level orchestration. Given a staged destination + a rule resolver (the source's filter set bound to its rule states), walks every file, parses inline state, resolves the final state, and writes it back. Skips the write entirely when the existing inline state already matches the resolved value (idempotency / no spurious diffs). Returns `{ canon, draft, untagged }` plus a list of `BadInlineStateWarning` / `DisagreementWarning` records. |

#### Resolution algorithm

For each materialized file under a staged destination `<destination>.tmp-XXXX/`:

1. Look up the format via `format.ts`. If unsupported, increment `untagged` and skip.
2. Read the file once. The format's parser returns one of `{ state: "draft" \| "canon" }`, `{ invalid: rawValue }`, or `undefined`.
3. If `state` is valid → resolved state is that value; source-of-truth = `inline`. Go to step 6.
4. If `invalid` → emit a `BadInlineStateWarning { file, raw }` for the source, then **fall through** to step 5 as if no inline state were present (per [Document State Tagging P0](features/document-state-tagging.md) — invalid inline values are warning-level, not failures, so a single typo never kills a file or a source).
5. Rule resolution. Match the file's source-relative path against each entry in the source's filter set (`PublishedDocument[]` for manifest-driven, `IncludeEntry[]` for includes-driven). Pattern matching uses `picomatch.isMatch(filePath, pattern, { dot: false, nocase: false })`. The **first matching entry** with a non-empty `state` is the rule-level state; source-of-truth = `rule`. If no entry matches, or every matching entry leaves `state` unset, the resolved state is the default `"draft"`; source-of-truth = `default`.
6. Pass the resolved state to the format's writer. The writer returns either the original bytes (no inline change needed — idempotent) or new bytes; the applier writes only when the bytes changed.
7. Increment the per-state counter (`canon` or `draft`). When verbose output is enabled, append a `{ file, state, sourceOfTruth }` record to the verbose stream.
8. (P2) When step 3 produced `inline` *and* step 5 would have produced a different state, emit a `DisagreementWarning { file, inline, rule }`. The inline value still wins; the warning is informational.

`picomatch` is already present transitively via `globby` / `fast-glob` and is declared as a direct dependency in [stack.md §11](stack.md) so the import does not rely on transitive resolution.

#### Schema chokepoint

- **Maester config** (`src/schemas/maester.ts`). `PublishedDocument` gains `state: z.enum(["draft", "canon"]).optional()`. The schema remains `.strict()`, so any other value is rejected at parse time with the offending field path.
- **Citadel config** (`src/schemas/citadel.ts`). `Source.includes` becomes `z.array(z.union([includePathString, z.object({ path: includePathString, state: z.enum(["draft", "canon"]).optional() }).strict()])).min(1).optional()`. The single `includePathString` schema is the shared shape validator (no leading `/`, no `..`, no whitespace-only); whichever shape the entry takes, the path validation is identical to today's bare-string form.
- **Inline parsers.** All five inline parsers route their raw value through `parseState()` (`src/core/state/schema.ts`). The function returns `"draft" \| "canon"` for valid input, `{ invalid: raw }` for explicitly-present-but-out-of-vocabulary input, and `undefined` for missing input.

#### Sync output shape

The per-source `SyncOutcome` returned by `src/core/sync/runner.ts` gains:

```ts
type StateBreakdown = { canon: number; draft: number; untagged: number };
type StateWarning =
  | { type: "bad-inline-state"; file: string; raw: string }
  | { type: "disagreement"; file: string; inline: State; rule: State };

type SyncOutcome = /* existing fields */ & {
  stateBreakdown: StateBreakdown;
  stateWarnings: StateWarning[];
};
```

The human-readable renderer prints the breakdown on the source's summary line (`canon: N · draft: N · untagged: N`). `--json` includes both fields verbatim per source. The verbose-output source-of-truth list is rendered as an indented sub-list under each source when `--verbose` is in effect.

#### What state tagging never does

- It never modifies the maester's source files. Only files in the citadel's staged destination are touched.
- It never tags a file whose extension is not in the v1 dispatch table (binary assets, PDFs, images). Those files are materialized untouched and reported as `untagged` in the breakdown. A future sidecar-metadata feature can close that gap; this architecture does not.
- It never overrides an inline state declared by a file's author — even when a maester-config or citadel-config rule disagrees. The optional P2 `DisagreementWarning` exists to make that override visible without changing its outcome.

---

## 7. Authentication & Authorization Architecture

The application has no in-process authorization layer. It operates with the invoking user's filesystem permissions and the credentials their environment grants to outbound git operations. The *only* authentication surface is the auth attached to each `Source` — every source uses the same `AuthRef` discriminated union, the same env-var resolution path, and the same redaction rules, regardless of whether the source is manifest-driven or includes-driven.

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
# a local destination directory.
#
# Each source is a git repository. By default, the citadel fetches whatever
# the source publishes in its own `maester.yaml` manifest (the source repo
# owns the publish surface). If a source does not publish a manifest — or
# you want to override what gets pulled — declare an `includes` list on the
# source and the citadel will materialize exactly those paths or globs
# instead (the citadel owns the filter set).
#
# By default, every source is surfaced at `<baseDir>/<source-name>/` from the
# repository root. The optional top-level `baseDir` field below changes that
# parent folder once for every source; when omitted, the default is `citadel`.
# A per-source `destination` always wins over the configured base.
#
# Run `maester sync` (or `npm run maester:sync`) to refresh every source in
# one pass. Generated by `npx maester init` and safe to commit. Secret
# values are never stored here — only the names of environment variables
# that hold them.

schemaVersion: 1

# Optional. Parent folder for every source that does not set its own
# `destination` override. Omit (or set to `citadel`) to keep the default.
# Repo-relative path; leading slashes and `..` segments are rejected.
# baseDir: vendor

sources:
  # Manifest-driven: the remote publishes its own maester.yaml.
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

  # Private repository over SSH. The user's local SSH agent / keys are used
  # by the underlying git binary.
  - name: architecture-notes
    url: git@github.com:example-org/architecture-notes.git
    ref: main

  # Custom destination override. By default, content is surfaced at
  # `<baseDir>/<name>/`; this one is redirected to `vendor/tokens/` regardless
  # of what `baseDir` is set to. The override is repo-relative; leading
  # slashes and `..` segments are rejected.
  - name: design-tokens
    url: https://github.com/example-org/design-tokens.git
    ref: release/2026.05
    destination: vendor/tokens

  # Includes-driven: a third-party public repo with no maester.yaml.
  # The citadel owns the `includes` list. Update it if the upstream repo
  # restructures — the "no files matched" warning will surface drift on the
  # next sync.
  #
  # Two entry shapes are accepted: a bare string (just the path/glob) or an
  # object with an optional `state: draft|canon` for files matched by that
  # entry. Files without an inline state get the rule's state; files without
  # either fall through to the default (draft). A file's own inline state
  # always wins over a rule.
  - name: react-docs
    url: https://github.com/facebook/react.git
    ref: main
    includes:
      - path: docs/**/*.md
        state: canon
      - README.md
    description: Upstream React documentation snapshot.

  # Includes-driven private vendor repo you have read access to but do not own.
  # Same env-var-name auth pattern as any other private source.
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
  # Marked `canon` — consuming citadels will surface it with state=canon
  # in its inline frontmatter unless the file itself declares otherwise.
  - path: README.md
    category: readme
    description: Service overview, local development setup, and ownership.
    state: canon

  # An ADR (architecture decision records) directory exposed via a glob.
  # Consuming citadels surface every matching file at sync time. The whole
  # group is marked `canon` here; an individual ADR can still opt back to
  # `draft` by adding `state: draft` to its own frontmatter.
  - path: docs/adr/*.md
    category: adr
    description: Architecture decisions made on this service.
    tags:
      - architecture
      - decisions
    state: canon

  # On-call runbooks, recursively. Left without an explicit `state` field
  # so each runbook governs its own state via inline frontmatter; runbooks
  # that don't declare one will fall through to the default (draft).
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
    state: canon

  # A single specific file with no metadata at all — description, category,
  # tags, and state are all optional.
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

**Resolution.** When a source has no citadel-side `includes`, the remote's `maester.yaml` lives at the root of the resolved tree and is discovered as part of the fetch strategy in §6.7. If present and `zod`-valid against the v1 maester schema, the listed `documents[].path` globs become the sparse-checkout pattern set. If absent or schema-invalid, the entry fails with a typed `MaesterError` (`MAESTER_MANIFEST_MISSING` / `MAESTER_MANIFEST_INVALID`) — sync never falls back to materializing the full tree, because doing so would silently ignore the source repo's role as owner of the publish surface. Consumers who want unfiltered content from such a source must add an `includes` list on the citadel side (switching the source to includes-driven mode). See §6.7 for the full fetch sequence and the citadel-cannot-override rationale.

#### Gap 8 — Sync of a non-existent remote ref

**What's missing.** No PRD covers the case where a configured `ref` does not exist on the remote.

**Why it matters.** This is a routine misconfiguration (typoed branch name) that must produce a clear, single-source failure rather than crash the runner.

**Resolution.** `src/core/git/client.ts.resolveRef()` is the single chokepoint; if the ref cannot be resolved, it throws a typed `RefNotFoundError`. The runner catches this and marks the source as `failed` with the message "ref `<ref>` not found on `<url>`". No other sources are affected. Exit code is non-zero as required by P0. Applies uniformly regardless of whether the source is manifest-driven or includes-driven.

#### Gap 9 — Citadel schema field naming

**What's missing.** The citadel needs a YAML shape that covers both modes of source (manifest-driven and includes-driven) without forcing the user to label which mode a source is in.

**Why it matters.** Two parallel top-level arrays (one per mode) would force the user to make a labeling decision before reaching the actual differences between the modes — a UX cost paid for an artificial taxonomy.

**Resolution.** (User-confirmed.) The citadel schema has a single top-level `sources:` array. Each entry is a `Source` (same TypeScript type for every source). The mode is implicit from whether the entry declares an `includes` list:

- `includes` unset → manifest-driven (the remote's `maester.yaml` governs).
- `includes` set (length ≥ 1) → includes-driven (the citadel governs; the remote `maester.yaml` is ignored even if present).

Schema version is `1`. There is no prior release, so no backward-compatibility logic is required.

#### Gap 10 — Source fetcher abstraction

**What's missing.** `src/core/sync/runner.ts` should not embed the full fetch pipeline inline, because the manifest-driven and includes-driven paths share most of their behavior but diverge on Stage 1, and the architecture's forward-looking note (Google Drive, OneDrive, web URLs) anticipates additional non-git source kinds in the future.

**Why it matters.** Determines how cleanly the implementing agent can add a new source kind later, and how testable each branch is in isolation.

**Resolution.** A single module `src/core/sources/fetcher.ts` exports `fetchSource(entry, ctx)` which branches internally on `entry.includes`. The function returns:

```ts
type FetchContext = {
  cacheDir: string;          // .maester/cache/<name>/
  cacheExists: boolean;
  tokenForUrl: string | undefined;
};

type FetchedTree = {
  name: string;
  cacheDir: string;
  commitSha: string;
  filterSet: readonly string[]; // globs that produced this tree
  warnings: FetchWarning[];     // e.g. zero-files-matched
};
```

The runner becomes a thin orchestrator: call `fetchSource(entry, ctx)`, then stage → promote → write provenance. Future non-git source kinds will be added alongside this fetcher (e.g. `src/core/sources/http.ts`) and dispatched by a field on the source entry.

#### Gap 11 — Name and destination collision enforcement

**What's missing.** All source names must be unique within a citadel, and destinations must not collide. The enforcement point must be a single chokepoint.

**Why it matters.** Without a single chokepoint, collisions could pass schema parsing only to surface as confusing failures during sync (overwriting the wrong directory, ambiguous CLI scoping).

**Resolution.** Both invariants are enforced at config-validation time via a Zod `.superRefine` on `CitadelConfig`, before the loader hands a parsed value to any downstream caller. The refinement:

1. Asserts each `source.name` appears exactly once in `sources`. A duplicate reports both colliding entries by name and index via Zod's `addIssue`.
2. Asserts each resolved destination (`source.destination ?? \`${config.baseDir ?? "citadel"}/${source.name}\``) appears exactly once. A duplicate reports both colliding entries. The refinement reads `config.baseDir` from the parsed document so the collision check operates on the same resolved path that sync will write to.
3. Asserts `sources.length ≥ 1`. An empty citadel is rejected.

The init walkthrough runs the same validator before writing the file so collisions are caught at config-time, not sync-time.

#### Gap 12 — Zero-files-matched detection

**What's missing.** [Maester Sync P1](features/maester-sync.md) requires a "no files matched includes" warning for includes-driven sources. The detection point and effect on the run must be specified.

**Why it matters.** Determines whether a drifted source fails outright (too noisy — the destination is still in a consistent state), silently produces an empty directory (too quiet — the user can't tell something broke), or warns and continues.

**Resolution.** Detection happens inside `src/core/sources/fetcher.ts` after Stage 2 completes, only for includes-driven sources: the fetcher counts files materialized in the working tree. A zero count attaches a structured `FetchWarning` (`{ type: "no-matches", name, includes }`) to the returned `FetchedTree`. The runner forwards the warning to the per-source `SyncOutcome`, the human-readable renderer (one styled WARN line per warned source), and the `--json` stream (the warning is a field on the source's outcome object). Status remains the standard `added/updated/unchanged`; "no files matched" is a warning, not a failure, and exit code is unaffected.

#### Gap 13 — Sparse-checkout pattern shape and validation

**What's missing.** The `includes` field on a source needs a defined glob syntax and a shape validator.

**Why it matters.** Determines what patterns users can write and where invalid patterns are rejected. Inconsistent validation between init and sync would let bad patterns persist past commit.

**Resolution.** `includes` entries use the **same shape and validation** as `PublishedDocument.path` (defined in `src/schemas/maester.ts`): repo-relative, no leading `/`, no `..` segments, no whitespace-only entries, `globby` glob syntax. At sync time, the resolved `includes` are passed to git's sparse-checkout flag as discrete argv elements (never string-interpolated into a shell command), so glob metacharacters in patterns cannot escape the flag.

#### Gap 14 — Source destinations default to `<baseDir>/<name>/`

**What's missing.** Every source — manifest-driven or includes-driven — lands in `<baseDir>/<source-name>/` by default (where `baseDir` defaults to `citadel`). Worth recording as a single chokepoint rather than letting the implementation accidentally diverge.

**Resolution.** The destination-resolution helper in `src/core/config/paths.ts` is `defaultDestinationFor(repoRoot, sourceName, baseDir)`. It accepts any entry shaped as `{ name: string; destination?: string }` and is reused by every caller, with the parsed `config.baseDir` (or its `"citadel"` default) threaded through — sync runner, init finalizer, and the citadel `.superRefine` collision check. The shared-namespace invariant (Gap 11) prevents two sources from claiming the same path: the schema rejects them at parse time. There is no mode-specific logic.

#### Gap 15 — Configurable citadel base directory

**What's missing.** [Citadel Base Directory](features/citadel-base-directory.md) introduces an optional top-level `baseDir` that changes the parent folder for every entry whose `destination` is unset. The PRD settles the user-facing behavior; this architecture has to commit to where the field lives in the schema, where the resolution happens, and how the change ships without breaking existing configs.

**Why it matters.** Every place the architecture previously hardcoded `"citadel"` — the destination-resolution helper, the `.superRefine` collision check, the init walkthrough's preview text, the example YAML's header comment — now has to read from a single chokepoint instead. Multiple chokepoints would let the resolved path drift between collision-check time and sync time, allowing a config that validates but writes to the wrong place.

**Resolution.** (User-confirmed.)

1. **Schema shape.** `baseDir` is an optional, repo-relative string with the same shape validation as `Source.destination` (no leading `/`, no `..`, no whitespace-only). Configs that omit it continue to validate and behave identically to a literal value of `"citadel"`.
2. **Single chokepoint.** `defaultDestinationFor(repoRoot, sourceName, baseDir)` in `src/core/config/paths.ts` is the only place that computes a default destination. It applies `baseDir ?? "citadel"` internally so callers can pass through whatever the parsed config has without their own `??` fallback. Every caller — `src/core/sync/runner.ts`, `src/core/init/finalize.ts`, and the citadel `.superRefine` — threads the parsed `config.baseDir` through this helper.
3. **Init-time prompt.** The citadel-init walkthrough adds one prompt for the base directory, pre-filled with `citadel` and validated against the same shape rule as the schema. When the user accepts the default, init **omits** the field from the generated YAML — accepting the default produces a config indistinguishable from today's, minimizing the diff against pre-existing projects. When the user enters anything else, init writes the explicit `baseDir:` line.
4. **Non-destructive change.** If the user later edits `baseDir` and re-syncs, the runner writes to the newly-resolved destinations. Directories under the previous base are left in place — no deletion, no move, no warning. The destination-clobber guard remains intact because each managed directory still owns its `ProvenanceMarker`; orphaned ones are inert.
5. **Cache is unaffected.** The `.maester/cache/<source-name>/` layout is orthogonal to `baseDir`. The cache is keyed by source name only.

#### Gap 16 — Handling of out-of-vocabulary inline state values

**What's missing.** [Document State Tagging](features/document-state-tagging.md) declares that the inline state vocabulary is exactly `draft` and `canon`, but the original P0 capability wording said an inline value outside that set "fails the file" — without saying whether that takes the source down with it, and without distinguishing config-time validation (where strict rejection is unambiguously correct) from sync-time inline parsing (where granularity is a design choice).

**Why it matters.** A single typo in one inline tag should not vaporize an entire sync. But silently demoting a known-wrong value to `draft` is also wrong — the user's intent was clearly to declare a state, and the typo should be visible.

**Resolution.** (User-confirmed.) Maester-config and citadel-config schemas continue to **reject** unknown state values at parse time via `.strict()` `zod` schemas — these are committed configs, and typos are caught by the loader. **Inline** state parsing softens to a warning: when a file's inline `state:` value is present but not `draft` or `canon`, `src/core/state/applier.ts` emits a `BadInlineStateWarning { file, raw }`, treats the file as if no inline state were declared, and falls through to rule/default resolution. The file is still materialized; the source is not failed; the warning rides along in the per-source `SyncOutcome` and is surfaced in both human and `--json` output. This keeps the inline-state surface forgiving while still making the mistake visible. The PRD's P0 acceptance criterion has been reconciled to match this behavior.

#### Gap 17 — HTML state-comment placement relative to DOCTYPE

**What's missing.** [Document State Tagging](features/document-state-tagging.md) names HTML as a supported inline format with the comment `<!-- state: <value> -->` but does not say where the comment sits when a `<!DOCTYPE>` is present.

**Why it matters.** The parser's detection regex and the writer's insertion site must agree. Two valid options exist: before DOCTYPE (cheap to detect — always line 1) or after DOCTYPE (more strictly standard HTML).

**Resolution.** (User-confirmed.) The state comment is the **first line** of the file, before any `<!DOCTYPE>`. This mirrors this project's own `gspec/style.html` convention (`<!-- spec-version: v1 -->` on line 1, DOCTYPE on line 2) and lets the parser detect inline state with a single line-1 read. Browsers tolerate a leading comment without affecting rendering. `src/core/state/html.ts` writes and detects on line 1; the writer pushes any existing line-1 state comment out before re-inserting the resolved one, and otherwise prepends a fresh comment + newline.

#### Gap 18 — Frontmatter parsing implementation

**What's missing.** [Document State Tagging](features/document-state-tagging.md) requires reading and writing a `state` field inside markdown YAML frontmatter. The PRD does not name a library; the stack (`gspec/stack.md`) lists `eemeli/yaml` for general YAML parsing but no frontmatter-specific helper.

**Why it matters.** Hand-rolling frontmatter detection is small but error-prone (CRLF, optional trailing newline, embedded `---` inside the body). A dedicated library round-trips frontmatter without surprises.

**Resolution.** (User-confirmed.) Add `gray-matter` as a direct runtime dependency. `src/core/state/markdown.ts` reads via `matter(buf)` (returning `{ data, content }`), mutates `data.state`, and writes via `matter.stringify(content, data)`. `gray-matter` already round-trips existing frontmatter and prepends a new block when none exists. The stack manifest in [stack.md §11](stack.md) reflects the new dependency. Bundle-size impact is negligible at CLI scale (~50KB transitive); the trade-off favors correctness on edge cases over saving a small dependency.

#### Gap 19 — Where state-apply sits in the sync pipeline

**What's missing.** Document State Tagging requires that every materialized file at the citadel carry an inline state by the time the destination is promoted. The original `runner.ts` flow (copy filtered tree → write provenance → atomic rename) has no slot for a file-rewriting pass.

**Why it matters.** If state-apply runs against the promoted destination, a crash mid-rewrite leaves users with a partially-tagged destination — violating the "destination always reflects a consistent fetch" invariant. If it runs too early (e.g., against the cache before the staging copy), it would mutate the cache directory, defeating the cache's reuse goal.

**Resolution.** State-apply runs against the **staged copy** `<destination>.tmp-XXXX/` between the filtered-tree copy and the atomic `rename`. The staging directory is owned by sync and discarded on failure; rewriting files inside it is consistent with the existing temp-then-rename model. The §6.6 sequence diagram has been updated to show the new step. The promoted destination is therefore either fully tagged (success) or absent (a previous-run promote remains intact, untouched). The cache directory is never mutated by state-apply.

#### Gap 20 — Pattern matching strategy for rule resolution

**What's missing.** Rule-level state resolution requires matching a file's path against a glob entry from the source's filter set (`PublishedDocument[]` or `IncludeEntry[]`). The architecture previously used `globby` for filesystem-walk globbing but had no pure-pattern-matching primitive.

**Why it matters.** Rule resolution runs per-file, in-memory, against patterns we already know — no FS scan is needed or wanted. Using `globby` would re-scan the disk N times.

**Resolution.** `picomatch.isMatch(filePath, pattern, { dot: false, nocase: false })` is the chokepoint, called from `src/core/state/applier.ts`. `picomatch` is already present transitively via `globby` → `fast-glob`; declaring it directly in [stack.md §11](stack.md) makes the import contract explicit and survives transitive churn. Configuration (`dot: false, nocase: false`) matches `globby`'s default so a path that one tool considers a match, the other does too.

#### Gap 21 — First-match wins when multiple filter-set entries match a file

**What's missing.** A single file can be matched by more than one entry in a source's filter set (e.g. `docs/**/*.md` and `docs/runbooks/**/*.md` both match the same runbook). The PRD did not specify which entry's `state` applies.

**Why it matters.** Determinism. Without a fixed rule the resolved state could drift with rearrangements of the filter list.

**Resolution.** **First-match wins**, in source-file order (the order the entries appear in `maester.yaml`'s `documents:` or `citadel.yaml`'s `includes:`). The applier iterates the filter set in array order and stops at the first entry whose pattern matches the file under test; that entry's `state` (if set) is the rule-level state. If the matching entry has no `state`, the resolution proceeds to the default (`draft`) — it does **not** fall back to the next matching entry. This keeps the rule "the entry the author put first applies" without surprise. Users who want a narrow rule to win over a broad one simply list the narrow rule first.

### Assumptions

- **One repository, one role each.** A repo has at most one `citadel.yaml` and at most one `maester.yaml`. Both can coexist (as confirmed by [Maester Configuration P1](features/maester-configuration.md)); the schemas and tooling assume single-instance per role per repo.
- **No prior tool state to migrate.** This is a greenfield project. The loader supports forward-migration scaffolding but ships with v1 only.
- **Partial clone requires `git ≥ 2.27`.** The fetch strategy in §6.7 uses `--filter=blob:none` + sparse checkout. Older binaries fall back to a conventional `--depth=1` clone with a `--verbose` notice; final destination contents are identical.
- **`citadel/` is a safe default top-level directory.** No PRD prohibits the default. Users with a conflicting `citadel/` directory at their repo root will hit the destination-clobber guard (Gap 6) and be directed to either set the top-level `baseDir` to a different folder (Gap 15) or set per-source `destination` overrides.
- **`--json` output is one JSON object per line (NDJSON).** Implied by [stack.md §9](stack.md). Confirmed here so tests and downstream consumers can rely on it.

---

