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
| [Maester Sync](features/maester-sync.md) | `src/cli/commands/sync.ts` calling `src/core/sync/runner.ts`, which orchestrates `src/core/git/`, `src/core/auth/`, and `src/core/sync/stage.ts`. |

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
│   │   ├── sync/
│   │   │   ├── runner.ts                # Orchestrate per-maester fetch + stage + promote
│   │   │   ├── stage.ts                 # Write-to-temp, then rename for atomic promote
│   │   │   ├── filters.ts               # Respect maester-side publish manifest
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
    MaesterSource ||--o| AuthRef : "uses"
    MaesterSource ||--o| Destination : "writes to"
    Destination ||--|| ProvenanceMarker : "contains"
    MaesterConfig ||--o{ PublishedDocument : "declares"

    CitadelConfig {
        string schemaVersion "literal: 1"
        MaesterSource[] sources "min 1 in committed file"
    }
    MaesterSource {
        string name PK "unique within citadel"
        string url "https or ssh git remote"
        string ref "branch/tag/sha; default = remote HEAD"
        AuthRef auth "discriminated union"
        string destination "optional override; repo-relative"
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
        string maesterName
        string sourceUrl
        string ref
        string commitSha
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
| `schemaVersion` | integer literal | Required. v1 sets `1`. |
| `sources` | `MaesterSource[]` | Required. Length ≥ 1. Names unique. |

`zod` schema: `.strict()` — unknown top-level fields are rejected, surfacing typos as errors. Introduced by [Citadel Initialization](features/citadel-initialization.md); consumed by [Maester Sync](features/maester-sync.md).

#### MaesterSource (item inside `CitadelConfig.sources`)

| Field | Type | Constraints |
|---|---|---|
| `name` | string | Required. Slug shape: `^[a-z0-9][a-z0-9-]*$`. Unique within the citadel. |
| `url` | string | Required. Must parse as `https://`, `ssh://`, or `git@host:path` form. No whitespace. |
| `ref` | string | Optional. When absent, the remote's default branch is used at sync time. |
| `auth` | `AuthRef` | Optional; defaults to `{ type: "none" }`. |
| `destination` | string | Optional. Repo-relative path. Validation: no leading `/`, no `..` segments, no symlinks. Default: `citadel/<name>/`. |

Introduced by: [Citadel Initialization](features/citadel-initialization.md). Consumed by: [Maester Sync](features/maester-sync.md).

#### AuthRef

| Field | Type | Constraints |
|---|---|---|
| `type` | `"none" \| "token"` | Required. Discriminator. |
| `envVar` | string | Required iff `type === "token"`. Conventional shape `^[A-Z][A-Z0-9_]*$`. **The variable name is committed; the value is never written to disk.** |

The init walkthrough validates that the entered string looks like an env-var name (uppercase, no whitespace) and surfaces a warning if it resembles a token (length ≥ 32 and no underscores) before saving. See §7.

#### Destination (implicit, computed at sync time)

Not a persisted entity. Computed per source as `source.destination ?? path.join(repoRoot, "citadel", source.name)`. Sync refuses to write into a destination that contains content lacking a `ProvenanceMarker` (see Risk Mitigation in [maester-sync.md](features/maester-sync.md)).

#### ProvenanceMarker (`.maester-source.json` inside each destination)

| Field | Type | Constraints |
|---|---|---|
| `maesterName` | string | Matches the source name in citadel.yaml. |
| `sourceUrl` | string | Redacted (no embedded token). |
| `ref` | string | The ref the source was resolved to. |
| `commitSha` | string | Full 40-char SHA. |
| `syncedAt` | ISO 8601 string | UTC. |

Written atomically as the last step of a successful per-maester sync. Used by future runs to recognize "this directory is mine" before overwriting. Introduced by [Maester Sync](features/maester-sync.md) (P2 capability — built from day one because the destination-clobber guard needs it).

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
- **`MaesterSource.name` is the join key everywhere.** The slug shape is required so it can safely be used as a directory name (`citadel/<name>/`), a CLI argument (`maester sync foo bar`), and a key in result tables.
- **Schema versioning.** v1 schemas declare `schemaVersion: 1`. The loader (`src/core/config/loader.ts`) reads `schemaVersion` first; unknown versions are rejected with an error pointing at the upgrade path. Migrations live in `src/core/config/migrations/` once v2 lands.

---

## 4. API Design

**Not applicable.** There is no network API. The application's interface to the outside world is the CLI command surface (described in §6) and the library export surface in `src/index.ts`. The library export shape:

```ts
// src/index.ts
export { loadCitadelConfig, loadMaesterConfig } from "./core/config/loader.js";
export { runSync } from "./core/sync/runner.js";
export type { CitadelConfig, MaesterSource, AuthRef } from "./schemas/citadel.js";
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
| Auth resolver | `src/core/auth/resolver.ts` | Given an `AuthRef`, return either `{ type: "delegated" }` or `{ type: "token", value: string }` read from `process.env[authRef.envVar]`. Throws `AuthError` naming the missing variable. |
| Sync runner | `src/core/sync/runner.ts` | For each source: fetch → resolve ref → stage → promote → write provenance marker. Aggregates per-maester results. Never throws on a single-source failure; per-source failures are returned as `SyncOutcome` values. |
| Staging | `src/core/sync/stage.ts` | Write all output to `<destination>.tmp-<rand>`, then `fs.rename` to the final destination. Old destination is removed under a temp name and unlinked after the rename succeeds. |
| Provenance | `src/core/sync/provenance.ts` | Read/write `.maester-source.json` inside each destination directory. Validates `maesterName` matches before overwriting. |
| Gitignore | `src/core/repo/gitignore.ts` | Append missing entries to `.gitignore`; never reorder or rewrite. Returns the set of lines that were added. |

### 6.4 External Integrations

| Integration | How |
|---|---|
| User's `git` binary | Wrapped by `simple-git` behind `src/core/git/client.ts`. Detected at startup; missing binary produces a clear, actionable error before any other work. |
| npm registry | Publishing target only. No runtime calls. |
| Google Drive / OneDrive / web URLs | Planned. To be added as separate source-type modules under `src/core/sources/` once introduced; each module implements the same `SourceFetcher` interface that `runner.ts` consumes. Out of scope for v1. |

### 6.5 Background Jobs / Events

Not applicable. The CLI is a single-shot process. Within a single sync invocation, multiple sources may be fetched in parallel (default concurrency: 4, capped at the number of configured sources) using `Promise.all` with a small concurrency limiter — but there is no queue, scheduler, or daemon.

### 6.6 Sync Run Flow

```mermaid
sequenceDiagram
    actor U as User
    participant CLI as src/cli/commands/sync.ts
    participant Runner as src/core/sync/runner.ts
    participant Loader as src/core/config/loader.ts
    participant Git as src/core/git/client.ts
    participant Stage as src/core/sync/stage.ts
    participant FS as Filesystem

    U->>CLI: maester sync
    CLI->>Loader: loadCitadelConfig(repoRoot)
    Loader-->>CLI: CitadelConfig | throws ConfigError
    CLI->>Runner: runSync(config, { scope, concurrency })
    loop For each MaesterSource (parallel, bounded)
        Runner->>Git: clone or fetch into .maester/cache/<name>/
        Git-->>Runner: resolved commit SHA
        Runner->>FS: read maester.yaml from cache (if present) -> filters
        Runner->>Stage: copy filtered tree to <destination>.tmp-XXXX
        Stage->>FS: write provenance marker
        Stage->>FS: rename(.tmp-XXXX, destination) [atomic]
        Stage-->>Runner: SyncOutcome { added | updated | unchanged | failed }
    end
    Runner-->>CLI: SyncResult { outcomes[] }
    CLI->>U: human-readable summary or JSON stream
```

### 6.7 Fetch Strategy (Partial Clone + Sparse Checkout)

Sync never performs a plain `git clone <url>`. A plain clone transfers every blob in every tracked tree at the configured ref — wasteful when the maester only publishes a few documents, and incompatible with the trust model described in [maester-sync.md P1](features/maester-sync.md) (the maester owns its publish surface). Instead, every fetch is a two-stage operation: a **manifest-discovery stage** that pulls only the maester's self-description, followed by a **selective-checkout stage** that materializes only the files the maester publishes.

The strategy is implemented in `src/core/sync/runner.ts` (orchestration) and `src/core/git/client.ts` (the specific git invocations).

#### Stage 1 — Manifest discovery

For each `MaesterSource`, on the very first sync (cache directory empty):

```sh
git clone \
  --filter=blob:none \
  --depth=1 \
  --branch <source.ref>          # omitted when ref is unset; remote HEAD is used
  --no-checkout \
  --sparse \
  <source.url> .maester/cache/<source.name>
```

What this transfers from the remote:

- Commit object at the configured ref (one commit).
- Tree objects reachable from that commit.
- **Zero blobs.** `--filter=blob:none` defers blob downloads until a working-tree operation references them.

Then inside the cache directory:

```sh
git sparse-checkout set --no-cone maester.yaml
git checkout <ref>
```

Effect: git lazily downloads exactly one blob — `maester.yaml` from the repo root, if it exists — and writes it to the working tree. Nothing else is materialized. If `maester.yaml` is absent from the tree, the checkout completes with an empty working directory (no error).

`src/core/sync/filters.ts` then reads `<cache>/maester.yaml`:

| Outcome | Behavior in Stage 2 |
|---|---|
| File present, parses against the v1 maester schema | The set of `documents[].path` globs becomes the sparse-checkout pattern set. |
| File present, schema-invalid | Logged as a non-fatal warning; this source falls back to "no manifest" behavior. |
| File absent | This source falls back to "no manifest" behavior. |

"No manifest" behavior = the citadel must consume the full tree, since the maester has not declared a publish surface. This is the documented default in [maester-sync.md P1](features/maester-sync.md).

#### Stage 2 — Selective checkout

With the manifest's globs in hand:

```sh
git sparse-checkout set --no-cone -- \
  README.md \
  'docs/adr/*.md' \
  'docs/runbooks/**/*.md' \
  docs/api/reference.md \
  CHANGELOG.md

git checkout <ref>
```

Or, when falling back to a full tree:

```sh
git sparse-checkout disable
git checkout <ref>
```

Either way, git fetches only the blobs that match the active checkout patterns. The cache directory's working tree now contains exactly the files that will be copied to the destination.

#### Subsequent runs (cache already populated)

On every run after the first, the cache directory already exists:

```sh
git -C .maester/cache/<source.name> fetch --depth=1 origin <ref>
git -C .maester/cache/<source.name> reset --hard FETCH_HEAD
```

If `maester.yaml` is unchanged between runs (compared by blob SHA), Stage 2's sparse pattern set is reused as-is. If it changed, Stage 1's discovery step re-runs against the new tree before Stage 2.

A source is reported as `unchanged` when the fetched commit SHA matches the SHA recorded in the destination's provenance marker — no blobs are downloaded beyond the manifest, no files are copied, no rename happens.

#### Bandwidth and disk impact

| Scenario | Blob transfer |
|---|---|
| Maester publishes `README.md` only (1 file) | 1 blob — the README — plus tree metadata. |
| Maester publishes 30 files via globs | 30 blobs plus tree metadata. |
| Maester has no `maester.yaml` | Full tree — same as a conventional clone at the configured ref. |
| Re-sync, remote unchanged | 0 blobs. One `git fetch` round-trip that returns "up to date." |

Disk: each source's cache holds only the materialized files for that source plus git's own metadata. A maester publishing a single README occupies kilobytes, not the full repo size.

#### Fallback for older `git`

Partial clone (`--filter=blob:none`) requires `git ≥ 2.27` (May 2020). `src/core/git/client.ts` probes `git --version` at startup. On older binaries the runner falls back to a conventional `git clone --depth=1 <url>`, logs a `--verbose` notice naming the missing optimization, and proceeds — the trust model and final destination contents are identical; only the bandwidth efficiency is lost.

#### Why the citadel does not filter

It would be technically straightforward to let `citadel.yaml` declare its own `paths:` filter per source and apply that filter on the citadel side. The architecture deliberately omits this. The maester is the authority on what it publishes; a citadel-side override would let a citadel operator pull files the maester did not include in its manifest — defeating the publish-surface contract in [maester-configuration.md](features/maester-configuration.md) §3. If a citadel needs a narrower view than the maester offers, that is a conversation to have with the maester's maintainers, not a config toggle.

---

## 7. Authentication & Authorization Architecture

The application has no in-process authorization layer. It operates with the invoking user's filesystem permissions and the credentials their environment grants to outbound git operations. The *only* authentication surface is the auth attached to each `MaesterSource`.

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
| `<repo-root>/citadel/<name>/.maester-source.json` | `src/core/sync/provenance.ts` | Sync runner | Sync runner (destination-clobber guard) |
| `<repo-root>/.gitignore` (append-only) | n/a | Citadel init + sync runner | git |

### Example `citadel.yaml`

```yaml
# citadel.yaml
#
# This file declares the remote knowledge sources ("maesters") that this
# repository pulls into its local `citadel/` directory. Run `maester sync`
# (or `npm run maester:sync`) to refresh the configured sources.
#
# Generated by `npx maester init` and safe to commit. Secret values are
# never stored here — only the names of environment variables that hold them.

schemaVersion: 1

sources:
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
  # manager. Sync fails for this source if MAESTER_PLAYBOOKS_TOKEN is unset,
  # but continues processing the other sources.
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

  # A source with a custom destination override. By default, content is
  # surfaced at `citadel/<name>/`; this one is redirected to `vendor/tokens/`
  # instead. The override is repo-relative; leading slashes and `..` segments
  # are rejected by the validator.
  - name: design-tokens
    url: https://github.com/example-org/design-tokens.git
    ref: release/2026.05
    destination: vendor/tokens

  # A source pinned to a specific commit SHA for reproducible builds.
  - name: security-standards
    url: https://github.com/example-org/security-standards.git
    ref: 9f4a2c1b5e8d7f3a6c0b4e2d1f5a8c7b9e0d3f6a
    auth:
      type: token
      envVar: MAESTER_SECURITY_TOKEN
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

**Resolution.** `src/core/git/client.ts.resolveRef()` is the single chokepoint; if the ref cannot be resolved, it throws a typed `RefNotFoundError`. The runner catches this and marks the source as `failed` with the message "ref `<ref>` not found on `<url>`". No other sources are affected. Exit code is non-zero as required by P0.

### Assumptions

- **One repository, one role each.** A repo has at most one `citadel.yaml` and at most one `maester.yaml`. Both can coexist (as confirmed by [Maester Configuration P1](features/maester-configuration.md)); the schemas and tooling assume single-instance per role per repo.
- **No prior tool state to migrate.** This is a greenfield project. The loader supports forward-migration scaffolding but ships with v1 only.
- **Partial clone requires `git ≥ 2.27`.** The fetch strategy in §6.7 uses `--filter=blob:none` + sparse checkout. Older binaries fall back to a conventional `--depth=1` clone with a `--verbose` notice; final destination contents are identical.
- **`citadel/` is a safe default top-level directory.** No PRD prohibits the default. Users with a conflicting `citadel/` directory at their repo root will hit the destination-clobber guard (Gap 6) and be directed to set per-source `destination` overrides.
- **`--json` output is one JSON object per line (NDJSON).** Implied by [stack.md §9](stack.md). Confirmed here so tests and downstream consumers can rely on it.

---

