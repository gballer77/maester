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
| [Citadel Status](features/citadel-status.md) | `src/cli/commands/status.ts` (CLI binding) calling `src/core/status/runner.ts`, which calls `src/core/status/probe.ts` per source. The probe uses `git ls-remote` for the commit SHA and a one-blob partial-clone + sparse-checkout into an ephemeral temp dir for the remote `maester.yaml`. Reuses `src/core/config/loader.ts`, `src/core/auth/resolver.ts`, and `src/core/sync/provenance.ts` (read-only). Never writes to a destination, never mutates `.maester/cache/`, never rewrites a provenance marker. |
| [Grand Maester Skill](features/grand-maester-skill.md) | New `src/core/skill/` cluster (`runner.ts`, per-agent target writers under `targets/`, the `managed-region.ts` convention, `version.ts`, `runtime.ts`, and templates under `templates/`) plus `src/cli/commands/skill.ts` for the `maester skill <verb>` group. The same install/upgrade orchestration is invoked from `src/cli/commands/init.ts` at the end of the citadel walkthrough when the user opts in. The PreToolUse hook on Claude Code is path-scoped to citadel reads and delegates to `maester skill runtime preread`, which reuses `src/core/status/runner.ts`. See §6.10. |
| [Traveling Maesters](features/traveling-maesters.md) | New `src/core/connectors/` cluster (compile-time type registry + per-type implementations under `types/<type-id>/`, shared dispatch and error mapping) and `src/core/mcp/` cluster (stdio MCP server built on `@modelcontextprotocol/sdk` plus per-host config writers under `registrations/`). New CLI verbs `maester mcp` (runs the server, registered in `src/cli/commands/mcp.ts`) and `maester connector <add\|remove\|list\|exec>` (`src/cli/commands/connector.ts`, where `exec <name> <op>` is the fallback dispatch for non-MCP hosts). Citadel schema in `src/schemas/citadel.ts` gains an optional `connectors` array; per-type config validation runs in a Zod `superRefine` that consults the registry. Init walkthrough adds a connector-registration step between source registration and the Grand Maester offer; standalone `maester connector add/remove` refresh installed per-host MCP registrations. Grand Maester install/upgrade writes the maester MCP server entry into each installed MCP-capable target's config alongside the existing skill artifacts. See §6.11. |
| [GitLab Issues Connector](features/gitlab-issues-connector.md) | New `src/core/connectors/types/gitlab-issues/` cluster: `schema.ts` (per-type config), `client.ts` (thin native-`fetch` facade over `/api/v4`), `operations.ts` (the two operation handlers — `list-issues`, `get-issue`), `output.ts` (issue-object shape + `dataSchema: 1` version), `errors.ts` (HTTP-status-to-error-code mapping). Registered with the connector type registry under identifier `gitlab-issues`. Pure leaf module — never imported by the framework directly; only the registry references it. See §6.12. |

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
│   │   ├── menu.ts                      # `npx baller-maester` interactive top-level menu
│   │   └── commands/
│   │       ├── connector.ts             # `maester connector <add|remove|list|exec>` (mgmt + fallback dispatch via `exec <name> <op>`)
│   │       ├── init.ts                  # Citadel initialization walkthrough
│   │       ├── mcp.ts                   # `maester mcp` — runs the stdio MCP server in cwd
│   │       ├── publish.ts               # Maester (publish manifest) walkthrough
│   │       ├── skill.ts                 # `maester skill <verb>` group (install/upgrade/add-target/status/runtime)
│   │       ├── status.ts                # Status check CLI binding (read-only)
│   │       └── sync.ts                  # Sync runner CLI binding
│   ├── core/                            # Domain logic. No terminal I/O, no process.exit.
│   │   ├── config/
│   │   │   ├── loader.ts                # yaml.parse + zod.parse; structured errors
│   │   │   ├── writer.ts                # Serialize to YAML; preserve comments on rewrite
│   │   │   └── paths.ts                 # Locate citadel.yaml / maester.yaml at repo root
│   │   ├── connectors/                  # Traveling Maesters framework + per-type implementations
│   │   │   ├── registry.ts              # Compile-time type registry; type-id -> ConnectorType
│   │   │   ├── dispatch.ts              # invokeOperation(connector, op, args) -> ResultEnvelope. Shared by MCP server + fallback CLI
│   │   │   ├── envelope.ts              # Success/failure envelope builders + schema/dataSchema constants
│   │   │   ├── errors.ts                # Framework error codes (missing-env-var, auth-failed, remote-error, …)
│   │   │   ├── tool-name.ts             # Deterministic <connector>__<operation> normalization (kebab -> snake)
│   │   │   ├── input-schema.ts          # zod-to-json-schema bridge for inputSchema generation
│   │   │   └── types/
│   │   │       └── gitlab-issues/       # First-party connector type — see §6.12
│   │   │           ├── index.ts         # Exports the ConnectorType object (config schema, operations, describeTool)
│   │   │           ├── schema.ts        # Per-type config (host, project, apiVersion)
│   │   │           ├── client.ts        # Thin native-fetch facade over /api/v4
│   │   │           ├── operations.ts    # list-issues + get-issue handlers
│   │   │           ├── output.ts        # Issue object shape; dataSchema: 1
│   │   │           └── errors.ts        # HTTP-status -> framework error-code mapping
│   │   ├── mcp/                         # MCP server + per-host config registrations
│   │   │   ├── server.ts                # @modelcontextprotocol/sdk Server setup, tools/list + tools/call wiring
│   │   │   ├── transport.ts             # StdioServerTransport binding; stdout discipline for JSON-RPC
│   │   │   └── registrations/           # Per-agent-host MCP config writers
│   │   │       ├── index.ts             # Registry; iterates installed Grand Maester targets and dispatches
│   │   │       ├── claude-code.ts       # .mcp.json at repo root (managed mcpServers.maester entry)
│   │   │       ├── cursor.ts            # .cursor/mcp.json at repo root (same shape)
│   │   │       └── codex.ts             # <repo>/.codex/config.toml [mcp_servers.maester] block (TOML round-trip)
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
│   │   ├── status/                      # Read-only freshness check
│   │   │   ├── runner.ts                # Per-source orchestrator; returns StatusResult
│   │   │   └── probe.ts                 # ls-remote SHA + ephemeral sparse maester.yaml
│   │   ├── skill/                       # Grand Maester agent skill installer + runtime helper
│   │   │   ├── runner.ts                # install / upgrade / add-target orchestration
│   │   │   ├── version.ts               # SKILL_VERSION constant + read-installed-version helper
│   │   │   ├── managed-region.ts        # begin/end marker conventions per artifact format
│   │   │   ├── runtime.ts               # `maester skill runtime preread / status-summary` helpers
│   │   │   ├── targets/
│   │   │   │   ├── index.ts             # Target registry; dedup by output artifact path
│   │   │   │   ├── claude-code.ts       # .claude/skills/grand-maester/SKILL.md + .claude/settings.json hook
│   │   │   │   ├── codex.ts             # AGENTS.md writer (Codex CLI label)
│   │   │   │   ├── cursor.ts            # .cursor/rules/grand-maester.mdc
│   │   │   │   └── generic.ts           # AGENTS.md writer (generic label) — shares writer w/ codex.ts
│   │   │   └── templates/
│   │   │       ├── shells/              # TS modules assembling each artifact
│   │   │       │   ├── claude-code.ts
│   │   │       │   ├── agents-md.ts     # Shared writer for codex + generic (one file, two labels)
│   │   │       │   └── cursor.ts
│   │   │       └── content/             # Raw .md fragments (bundled as text via tsup loader)
│   │   │           ├── citadel-awareness.md
│   │   │           ├── state-awareness.md
│   │   │           └── freshness-awareness.md
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
| Status orchestrator | `src/core/status/runner.ts` | Read-only sibling of the sync runner; returns `StatusResult { outcomes[], counts }`; never writes to a destination, the cache, or a provenance marker. |
| Skill installer | `src/core/skill/runner.ts` | Orchestrates install / upgrade / add-target across selected agent targets; deduplicates targets that share an output path; returns a per-target `SkillInstallOutcome`. |
| Skill runtime helper | `src/core/skill/runtime.ts` | Backs `maester skill runtime preread` (the Claude Code PreToolUse hook entrypoint) and `maester skill runtime status-summary`. The pre-read helper reuses `runStatus()` from `src/core/status/runner.ts` to derive its verdict. |
| Skill version | `src/core/skill/version.ts` | `SKILL_VERSION` constant (sourced from package.json at build time) plus a `readInstalledSkillVersion(target)` helper used by the upgrade subcommand. |
| Connector type registry | `src/core/connectors/registry.ts` | Compile-time map of connector type identifier → `ConnectorType`. The only place that imports per-type modules; everything else in the framework consults the registry. |
| Connector dispatch | `src/core/connectors/dispatch.ts` | `invokeOperation(connector, operation, args)` is the shared entry-point used by both the MCP server (`src/core/mcp/server.ts`) and the fallback CLI (`src/cli/commands/connector.ts`). Returns the documented success/failure envelope. |
| MCP server | `src/core/mcp/server.ts` | Constructs the `@modelcontextprotocol/sdk` `Server`, registers `tools/list` and `tools/call` handlers built from the connector registry, and connects it via `StdioServerTransport`. Reads `citadel.yaml` once at startup. |
| Per-host MCP registrations | `src/core/mcp/registrations/index.ts` | Iterates installed Grand Maester targets via `listSkillTargets()` and dispatches to each host's writer (claude-code.ts, cursor.ts, codex.ts). Idempotent + managed-region. |

---

## 3. Data Model

There is no database. The application's "data model" is the set of YAML configuration documents committed to the user's repository plus a small managed cache state. Each document is described by a `zod` schema in `src/schemas/`. Schemas are versioned via a `schemaVersion` field so the loader can migrate older versions forward.

### Entity Relationship Diagram

```mermaid
erDiagram
    CitadelConfig ||--o{ Source : "registers"
    CitadelConfig ||--o{ Connector : "registers"
    Source ||--o| AuthRef : "uses"
    Source ||--o| Destination : "writes to"
    Destination ||--|| ProvenanceMarker : "contains"
    Connector ||--o| AuthRef : "uses"
    Connector ||--|| ConnectorType : "is of type"
    ConnectorType ||--o{ ConnectorOperation : "exposes"
    MaesterConfig ||--o{ PublishedDocument : "declares"

    CitadelConfig {
        string schemaVersion "literal: 1"
        string baseDir "optional; default 'citadel'; repo-relative"
        Source[] sources "length >= 1"
        Connector[] connectors "optional; default []"
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
    Connector {
        string name PK "unique within citadel.connectors"
        string type "must reference a registered ConnectorType"
        AuthRef auth "discriminated union; same shape as Source.auth"
        string description "optional; prepended to MCP tool descriptions"
        json config "per-type; validated by ConnectorType.configSchema"
    }
    ConnectorType {
        string id PK "compile-time identifier (e.g. gitlab-issues)"
        string label "human-readable target name in tools/list descriptions"
        zod configSchema "validates Connector.config at citadel-load time"
    }
    ConnectorOperation {
        string name "kebab-case (e.g. list-issues, get-issue)"
        json inputSchema "JSON Schema for tool arguments"
        function handler "(connector, resolvedConfig, args) -> ResultEnvelope"
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

#### Connector (item inside `CitadelConfig.connectors`)

| Field | Type | Constraints |
|---|---|---|
| `name` | string | Required. Slug shape (same as `Source.name`): `^[a-z0-9][a-z0-9-]*$`. Unique within `CitadelConfig.connectors`. A name that collides with a `Source.name` warns (does not reject) — see Gap 11 and §6.11. |
| `type` | string | Required. Must reference a registered `ConnectorType` (today: `gitlab-issues`). Validation runs in the citadel `.superRefine`; unknown types are rejected with a field-named error. |
| `auth` | `AuthRef` | Optional; defaults to `{ type: "none" }`. Same discriminated union as `Source.auth`. Read by `src/core/auth/resolver.ts` at MCP-tool-invocation time, not at config-load time. |
| `description` | string | Optional. Free text; prepended to the dynamically-built MCP tool descriptions for this connector's tools (see §6.11). |
| `config` | object | Per-type. The citadel schema accepts `z.unknown()` for this field and the `.superRefine` validates it against the registered type's `configSchema` after the type lookup. Unknown fields inside per-type config are rejected by that schema (each per-type schema is `.strict()`). |

Introduced by: [Traveling Maesters](features/traveling-maesters.md). Consumed by: `src/core/mcp/server.ts` (every configured connector becomes one or more MCP tools at startup), `src/core/connectors/dispatch.ts` (per-call dispatch from MCP or fallback CLI), and `src/core/mcp/registrations/*` (each writer learns from the citadel's connector list whether to write a `maester` entry for its host).

#### ConnectorType (compile-time registry value)

| Field | Type | Constraints |
|---|---|---|
| `id` | string | Required. Stable identifier, lowercase kebab-case. Used as the `type` value in citadel.yaml. |
| `label` | string | Required. Short human-readable name (e.g., `"GitLab Issues"`) used in CLI confirmation prompts and in the type's default tool descriptions. |
| `configSchema` | zod | Required. `.strict()` zod schema validating one connector entry's `config` object. |
| `operations` | record | Required. Map of operation name (kebab-case) to `ConnectorOperation`. |
| `describeTool` | function | Required. `(operation, resolvedConfig) => string` — returns the per-tool description used in `tools/list`. The connector entry's `description` (if set) is prepended to this by the framework, not by the type. |

Not a persisted entity. Lives only in `src/core/connectors/registry.ts` at runtime. Adding a new type is a purely additive change to that file plus the corresponding `types/<id>/` module.

#### ConnectorOperation (per-operation definition inside a `ConnectorType`)

| Field | Type | Constraints |
|---|---|---|
| `name` | string | Required. Operation name, kebab-case (e.g., `list-issues`, `get-issue`). Becomes the right-hand side of the MCP tool name after normalization (see Gap 37). |
| `argsSchema` | zod | Required. Validates the operation's args object. Converted to JSON Schema for MCP `inputSchema` via `zod-to-json-schema` at startup. |
| `dataSchemaVersion` | integer | Required. The per-type `dataSchema` value embedded in success payloads. Increments only on incompatible per-operation shape changes. |
| `handler` | function | Required. `(args, ctx) => Promise<EnvelopeBody>` — pure dispatch; receives validated args and a `ctx` containing the resolved per-type config + resolved auth token (or undefined). Returns either `{ data }` or throws a `ConnectorError` that the dispatcher maps onto an error envelope. |

The MCP server and the fallback CLI never invoke handlers directly; both go through `src/core/connectors/dispatch.ts.invokeOperation()`, which catches `ConnectorError` and wraps every outcome in the documented envelope (see §4).

#### GitLabIssuesConfig (the `config` payload for `type: gitlab-issues`)

| Field | Type | Constraints |
|---|---|---|
| `host` | string URL | Optional. Default `https://gitlab.com`. HTTPS only (validation rejects `http://` and malformed values at config-load time). |
| `project` | string | Required. Either a full URL-encoded path (`my-group/my-project`) or a numeric project ID. Validation: non-empty, no whitespace. Runtime interpretation: `^\d+$` → numeric project ID; otherwise URL-encode and use as a path (see Gap 45). |
| `apiVersion` | integer | Optional. Reserved for forward compatibility; v1 always targets `/api/v4`. Default unset. |

Introduced by: [GitLab Issues Connector](features/gitlab-issues-connector.md). Validated by `src/core/connectors/types/gitlab-issues/schema.ts`.

#### IssueOutput (the `data` payload returned by `gitlab-issues` operations)

| Field | Type | Constraints |
|---|---|---|
| `iid` | integer | Project-scoped issue identifier. |
| `id` | integer | GitLab global issue id. |
| `title` | string | |
| `description` | string \| null | Echoed verbatim from GitLab; no truncation in v1. |
| `state` | string | `"opened"` or `"closed"`. |
| `labels` | string[] | |
| `assignees` | array of `{ username, name }` | Empty array when no assignees. |
| `milestone` | `{ title, state }` \| null | `null` when not set. |
| `web_url` | string | |
| `created_at` | string | ISO 8601 (echoed). |
| `updated_at` | string | ISO 8601 (echoed). |
| `closed_at` | string \| null | ISO 8601 (echoed) or `null`. |

`list-issues` wraps an array of `IssueOutput` plus a `meta` block: `{ page, per_page, total_pages, total }` (the last two are `null` when GitLab omits the totals headers).

The whole payload carries `dataSchema: 1`; the version increments only on incompatible changes.

### Relationship Notes

- **No shared entities across roles.** A `CitadelConfig` and `MaesterConfig` can coexist in the same repo (both files at the root) but never reference each other inside the repo — the linkage happens *across* repos at sync time, when a citadel pulls a remote that itself has a `maester.yaml`.
- **All source names share a single namespace.** Every entry in `CitadelConfig.sources` has a unique `name`, so the slug can safely be used as a directory name (`citadel/<name>/`), a CLI argument (`maester sync foo bar`), and a result-table key. The same is true of resolved destinations — two sources cannot claim the same target directory.
- **Connector names live in a separate, parallel namespace.** Each `Connector.name` is unique within `CitadelConfig.connectors` and is the left-hand side of the MCP tool name (`<connector_name>__<operation>`). A connector name that collides with an existing source name is allowed (the namespaces are separate) but the management commands warn the user — reading the config can confuse a future maintainer (Gap 47).
- **AuthRef is reused, not re-declared.** Both `Source.auth` and `Connector.auth` reference the same `AuthRef` discriminated union, the same `src/core/auth/resolver.ts` chokepoint, and the same env-var-name-only persistence discipline (§7). The only difference is the consumer: sync injects the token into a `simple-git` HTTPS URL, the connector dispatcher passes it to the per-type client (e.g., GitLab's `PRIVATE-TOKEN` header).
- **Schema versioning.** Both the citadel schema and the maester (publish manifest) schema are at v1. The loader (`src/core/config/loader.ts`) reads `schemaVersion` first and rejects unknown versions with an error pointing at the upgrade path. The optional top-level `baseDir` is a backward-compatible additive field; configs that omit it continue to validate and behave identically.

---

## 4. API Design

The application has no network API to authenticate or rate-limit. There are three structured interfaces, in increasing distance from the package: the **MCP wire protocol** (the canonical agent-facing API in v1), the **library export surface** (for programmatic Node consumers), and the **CLI command surface** (described in §6).

### MCP wire protocol (canonical agent-facing API)

`maester mcp` runs a stdio-based **MCP server** built on `@modelcontextprotocol/sdk` (see Gap 34). It speaks the Model Context Protocol as JSON-RPC frames on stdin/stdout and is the canonical surface for AI agents reaching the citadel's configured connectors (issue trackers, etc.). HTTP-based MCP transport is deferred.

#### Methods supported

| Method | Purpose |
|---|---|
| `initialize` | Standard MCP handshake. Server returns its protocol version and tool capabilities. |
| `tools/list` | Returns one tool per (connector, operation) pair. Each tool carries `name` (`<connector>__<operation>`, normalized — see Gap 37), `description` (built dynamically from connector + type — see §6.11), and `inputSchema` (JSON Schema generated from the operation's zod `argsSchema` via `zod-to-json-schema` — see Gap 38). |
| `tools/call` | Invokes the named tool with the supplied `arguments`. The handler is dispatched through `src/core/connectors/dispatch.ts.invokeOperation()` and the result is returned as a single text content block carrying the JSON envelope below. Tool-level failures are returned as `{ isError: true, content: [{ type: "text", text: <error envelope JSON> }] }`. |

The server registers handlers via the SDK's typed setters (`server.setRequestHandler(...)`); we never frame JSON-RPC by hand. Diagnostics and warnings go to **stderr** — stdout is reserved exclusively for the SDK's wire frames (see Gap 41).

#### Connector envelope (shared between MCP results and the fallback CLI)

Every connector operation — whether dispatched through MCP or through the fallback `maester connector exec <name> <op>` CLI — emits the same deterministic JSON envelope. From MCP, the envelope is the body of a single text content block; from the fallback CLI, it is the entire stdout payload.

```jsonc
// success
{
  "schema": 1,
  "connector": "<name>",
  "operation": "<op>",
  "ok": true,
  "data": {
    "dataSchema": 1,
    "...per-type payload..."
  }
}

// failure
{
  "schema": 1,
  "connector": "<name>",
  "operation": "<op>",
  "ok": false,
  "error": {
    "code": "auth-failed",
    "message": "...",
    "details": { "...": "..." }
  }
}
```

`schema` is the envelope version (today: `1`). `data.dataSchema` is the per-type payload version, independent of the envelope (today the GitLab payload is at `1`). The envelope shape is built in `src/core/connectors/envelope.ts` and is the single chokepoint — neither the MCP server nor the fallback CLI assembles it by hand.

Documented `error.code` values (bounded set, treated as a stable interface — see Gap 44):

| Code | Cause |
|---|---|
| `missing-env-var` | The connector's `auth.envVar` is unset or empty at invocation time. Returned before any network call. |
| `connector-not-found` | The invocation referenced a connector name not in `citadel.yaml.connectors`. |
| `unknown-operation` | The connector exists but does not expose the requested operation. |
| `invalid-argument` | The operation's `argsSchema` rejected the supplied args (or an explicitly-rejected shape from the type's validator). |
| `auth-failed` | The remote service returned an auth failure (e.g., HTTP 401/403). The env-var **name** appears in the message; the value never does. |
| `remote-error` | The remote service returned a recognized non-auth failure (HTTP 404/429/5xx, transport, unexpected response shape). `details.kind` carries the sub-classification. |
| `internal-error` | An unexpected exception inside the connector implementation. Treated as a bug; the dispatcher logs to stderr and returns this envelope rather than crashing the server. |

Fallback CLI exit codes: `0` on success, `1` on any `ok: false` envelope, `2` for invocation-level errors (not in a citadel-bearing repo, malformed top-level args).

### Library exports

```ts
// src/index.ts
export { loadCitadelConfig, loadMaesterConfig } from "./core/config/loader.js";
export { runSync } from "./core/sync/runner.js";
export { runStatus } from "./core/status/runner.js";
export { runSkillInstall, runSkillUpgrade, listSkillTargets } from "./core/skill/runner.js";
export { invokeOperation, listConnectorTools } from "./core/connectors/dispatch.js";
export { CONNECTOR_TYPE_REGISTRY } from "./core/connectors/registry.js";
export type { CitadelConfig, Source, Connector, AuthRef } from "./schemas/citadel.js";
export type { MaesterConfig, PublishedDocument } from "./schemas/maester.js";
export type { SyncResult, SyncOutcome } from "./core/sync/runner.js";
export type { StatusResult, StatusOutcome, StatusVerdict, BehindReason } from "./core/status/runner.js";
export type { SkillTargetId, SkillInstallResult, SkillInstallOutcome } from "./core/skill/runner.js";
export type {
  ConnectorType,
  ConnectorOperation,
  ConnectorResultEnvelope,
  ConnectorErrorCode,
} from "./core/connectors/types.js";
```

Internal modules — including `src/core/mcp/*` and `src/core/connectors/types/*` — are not re-exported. The MCP server is invoked through the CLI binary (`maester mcp`), not through the library; programmatic consumers reach connectors via `invokeOperation()`.

### CLI surface

See §6 → CLI Command Surface.

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
| `maester status [names...]` | Read-only freshness check. Optional positional names scope the run to a subset. Exit codes: `0` (all up-to-date), `1` (≥ 1 behind, 0 failed), `2` (≥ 1 failed, or config/invocation error). |
| `maester status --json` | Status, emitting one JSON object per source on stdout (NDJSON). Same exit-code ladder. |
| `maester skill install` | Install the Grand Maester skill into the current citadel repo. Interactive multi-select of agent targets when no flags; non-interactive when `--target` is passed (`--target claude-code --target codex` etc.). |
| `maester skill upgrade` | Refresh every installed target's managed-region content to match the running `maester` version. `--check` reports which targets are outdated and exits non-zero without writing. |
| `maester skill add-target <id>` | Install an additional agent target alongside any already installed. |
| `maester skill status` | List installed targets, their on-disk version markers, and whether each is up to date with `SKILL_VERSION`. |
| `maester skill runtime preread` | Internal helper invoked by installed Claude Code hooks; reads a hook envelope from stdin, runs `maester status` when the targeted path is under the citadel base directory, emits a Claude Code `hookSpecificOutput.additionalContext` payload on stdout. Always exits `0`. |
| `maester skill runtime status-summary` | Internal helper that prints a one-line summary derived from `runStatus()`. Exit-code ladder mirrors `maester status`. |
| `maester mcp` | Runs the stdio MCP server for the current citadel-bearing repository. Reads `citadel.yaml`, instantiates configured connectors, and serves `tools/list` + `tools/call` over JSON-RPC frames on stdin/stdout. All non-protocol output (errors, warnings) goes to stderr. Intended to be spawned by an agent host's MCP client (Claude Code, Cursor, Codex CLI) per the registrations written by `maester connector add` / `maester skill install`. Exits non-zero with a stderr error when invoked outside a citadel-bearing repo or when `citadel.yaml` fails validation. See §6.11. |
| `maester connector add` | Interactive registration flow for a new connector (type picker, name prompt, env-var prompt, per-type config prompts). Refuses to write when invoked outside a citadel-bearing repo (exit `2`). After the citadel.yaml edit, refreshes the per-host MCP registrations for every installed Grand Maester target (Gap 46). |
| `maester connector remove <name>` | Deletes the named connector from `citadel.yaml` after a confirmation prompt and refreshes per-host MCP registrations. |
| `maester connector list` | Prints the configured connectors with their resolved tool names and types. Human-readable; agents go through MCP. |
| `maester connector refresh` | Re-validates `citadel.yaml` and re-runs `refreshMcpRegistrations(repoRoot)` against every installed Grand Maester target. Use after editing `citadel.yaml` by hand (the `add` / `remove` verbs already refresh automatically). Exit code `0` on success, `2` when `citadel.yaml` is missing or invalid. |
| `maester connector exec <name> <op> [--key value]...` | **Fallback** dispatch surface for non-MCP agent hosts (the Generic `AGENTS.md` Grand Maester target). One process per call. Dispatches through the same `src/core/connectors/dispatch.ts` the MCP server uses; output is the §4 success/failure envelope on stdout; exit code `0`/`1`/`2` as documented. Named MCP-capable agents always invoke through MCP and never use this surface. The `exec` verb (rather than bare positional `<name> <op>`) keeps Commander's subcommand resolver unambiguous alongside `add` / `remove` / `list` — see Gap 36. |
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
| Status runner | `src/core/status/runner.ts` | For each in-scope source: read provenance, call probe, compare, return a `StatusOutcome`. Aggregates a `StatusResult { outcomes, counts }`. Reuses sync's per-source concurrency primitive (default 4, `--concurrency <n>` override). Never throws on per-source failure. Never writes to a destination, the cache, or a marker. See §6.9. |
| Status probe | `src/core/status/probe.ts` | `probeCommitSha(entry, ctx)` calls `git ls-remote <url> <ref>` (via `src/core/git/client.ts`) to resolve the current commit SHA without cloning. `probeManifest(entry, ctx)` performs a `--filter=blob:none --depth=1` clone + sparse-checkout of `maester.yaml` into a temp dir under `.maester/.status-<rand>/`, parses it against `src/schemas/maester.ts`, and removes the temp dir in a `try/finally`. Both honor the resolved `AuthRef`. |
| Skill runner | `src/core/skill/runner.ts` | `runSkillInstall(repoRoot, { targets, mode: "install" \| "add-target" })`, `runSkillUpgrade(repoRoot, { check })`, `listSkillTargets()`. Dedupes selected targets by their resolved artifact path before writing; calls each target's writer once. Returns `SkillInstallResult { outcomes, counts }`. Never throws on a single-target failure; per-target failures are returned as outcomes. See §6.10. |
| Skill target writer | `src/core/skill/targets/*.ts` | Per-agent module exposing `{ id, label, defaultArtifactPath, write(input) }`. The Claude Code writer additionally manages the `.claude/settings.json` hook entry under the dedicated `maester` top-level key. Idempotent — running the writer twice produces byte-identical output. |
| Skill runtime helper | `src/core/skill/runtime.ts` | `preread(stdinPayload)` returns the Claude Code hook response envelope; calls `runStatus()` only when the targeted path resolves under the citadel `baseDir`; debounces via a small cache file at `.maester/.skill-cache.json`. `statusSummary()` returns a one-line human summary plus an exit-code recommendation. |
| Managed region | `src/core/skill/managed-region.ts` | Format-specific begin/end marker conventions: HTML comments for Markdown / `.mdc`, a dedicated top-level `maester` key for `.claude/settings.json`. The reader extracts the embedded version; the writer rewrites only what is inside the markers. |
| Connector registry | `src/core/connectors/registry.ts` | Compile-time map from connector type id (e.g. `"gitlab-issues"`) to its `ConnectorType` object (label, config schema, operations, `describeTool`). The only module that imports per-type implementations; everything else consults the registry. Loaded once at process start. |
| Connector dispatch | `src/core/connectors/dispatch.ts` | `invokeOperation(connector, operation, args, env)` — single chokepoint reused by `src/core/mcp/server.ts` and `src/cli/commands/connector.ts`. Validates args via the operation's `argsSchema`, resolves the auth env var, calls the handler, wraps every outcome in the §4 envelope. Never throws — connector implementation exceptions become `internal-error` envelopes. |
| Connector envelope | `src/core/connectors/envelope.ts` | Builders + constants for the §4 success/failure envelope. Single chokepoint so MCP and the fallback CLI never assemble the shape ad-hoc. |
| Connector tool-name normalizer | `src/core/connectors/tool-name.ts` | `toolName(connector, operation)` returns the `<connector>__<operation>` form with kebab-case parts converted to snake_case (Gap 37). Used by both `src/core/mcp/server.ts` (when registering tools) and `src/cli/commands/connector.ts` (for the `connector list` output to show the same names the agent sees). |
| MCP per-host registrations | `src/core/mcp/registrations/index.ts` | `refreshMcpRegistrations(repoRoot)` iterates installed Grand Maester targets via `listSkillTargets()`, dispatches to each host's writer (claude-code.ts, cursor.ts, codex.ts), and reports a per-target outcome. Idempotent; managed-region for each host's file format (Gap 39). Called by citadel-init (when relevant), `maester connector add/remove/refresh`, and `maester skill install/upgrade`. |
| Connector input-schema bridge | `src/core/connectors/input-schema.ts` | Wraps `zod-to-json-schema` to convert each operation's `argsSchema` into the JSON Schema MCP's `inputSchema` field expects. Pinned configuration (no `$defs`, no `$ref`) for maximum cross-host compatibility. |
| MCP server | `src/core/mcp/server.ts` | Constructs the `@modelcontextprotocol/sdk` `Server`, registers `tools/list` and `tools/call` handlers built from the connector registry + configured connectors, connects via `StdioServerTransport`. Reads `citadel.yaml` once at startup; validation failures cause a non-zero exit before any frames are exchanged. |
| MCP transport binding | `src/core/mcp/transport.ts` | Sets up `StdioServerTransport`, installs the stderr-only redirect for `consola` so stdout stays clean for JSON-RPC frames (Gap 41), and hooks the process to exit cleanly when stdio closes. |
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
- It never tags the root-level `maester.yaml` itself. The remote publish manifest is fetched alongside the published documents (so the citadel can see what the source declared) but it is a sync artifact, not a document; the applier skips it at the destination root. A `maester.yaml` nested under any subdirectory is treated as an ordinary YAML document and gets tagged normally.

### 6.9 Status Run Flow

`maester status [names...]` reports per-source verdicts in a fraction of the time and side-effects of a sync. The runner mirrors the sync runner's per-source parallelism (same default concurrency of 4, same `--concurrency <n>` override) but each source's pipeline is a probe instead of a fetch — no clone into the persistent cache, no staging directory, no destination write, no provenance rewrite.

```mermaid
sequenceDiagram
    actor U as User
    participant CLI as src/cli/commands/status.ts
    participant Runner as src/core/status/runner.ts
    participant Loader as src/core/config/loader.ts
    participant Prov as src/core/sync/provenance.ts
    participant Auth as src/core/auth/resolver.ts
    participant Probe as src/core/status/probe.ts
    participant Git as src/core/git/client.ts
    participant Remote as Git remote
    participant FS as Filesystem

    U->>CLI: maester status
    CLI->>Loader: loadCitadelConfig(repoRoot)
    Loader-->>CLI: CitadelConfig | throws ConfigError (exit 2)
    CLI->>Runner: runStatus(config, { scope, concurrency })
    loop For each source (parallel, bounded)
        Runner->>Prov: readProvenanceMarker(destination)
        alt marker absent or schema-invalid
            Prov-->>Runner: undefined
            Runner-->>Runner: verdict = "behind", reasons = ["never-synced"]
        else marker present
            Runner->>Auth: resolveAuth(source.auth, process.env)
            alt env-var missing for token auth
                Auth-->>Runner: throws AuthError
                Runner-->>Runner: verdict = "failed", error = redacted message
            else auth resolved
                Auth-->>Runner: { type: "delegated" } | { type: "token", value }
                alt source.ref matches /^[0-9a-f]{40}$/
                    Runner-->>Runner: resolvedSha = source.ref (short-circuit, no remote call)
                else
                    Runner->>Probe: probeCommitSha(entry, { token })
                    Probe->>Git: listRemoteRef(url, ref)
                    Git->>Remote: ls-remote (HTTPS or SSH)
                    Remote-->>Git: <sha> refs/...  (+ <sha>^{} for annotated tags)
                    Git-->>Probe: dereferenced commit SHA
                    Probe-->>Runner: resolvedSha
                end
                alt source.includes is set (includes-driven)
                    Runner-->>Runner: manifest-changed check skipped
                else manifest-driven
                    Runner->>Probe: probeManifest(entry, { token })
                    Probe->>FS: mkdtemp .maester/.status-<rand>/
                    Probe->>Git: partial clone + sparse-checkout(maester.yaml)
                    Git->>Remote: fetch tree metadata + 1 blob
                    Remote-->>Git: maester.yaml bytes
                    Git-->>Probe: parsed PublishedDocument[]
                    Probe->>FS: rm -rf .maester/.status-<rand>/
                    Probe-->>Runner: { filterSet }
                end
                Runner->>Runner: resolvedSha vs marker.commitSha
                Runner->>Runner: sortedSet(filterSet) vs sortedSet(marker.filterSet)
                Runner-->>Runner: verdict + reasons[]
            end
        end
    end
    Runner-->>CLI: StatusResult { outcomes, counts }
    CLI->>U: human summary or NDJSON stream
    Note over CLI: exit 0 (all up-to-date) | 1 (≥1 behind, 0 failed) | 2 (≥1 failed or config error)
```

#### Verdict shape

```ts
type StatusVerdict = "up-to-date" | "behind" | "failed";
type BehindReason = "never-synced" | "remote-ref-advanced" | "manifest-changed";

type StatusOutcome =
  | { name: string; verdict: "up-to-date"; commitSha: string }
  | {
      name: string;
      verdict: "behind";
      reasons: BehindReason[];
      commitSha?: string;     // recorded in provenance; absent when never-synced
      resolvedSha?: string;   // current remote SHA; absent when never-synced
    }
  | { name: string; verdict: "failed"; error: string };

type StatusResult = {
  outcomes: StatusOutcome[];
  counts: { upToDate: number; behind: number; failed: number };
};
```

The result type is exported from `src/core/status/runner.ts` and re-exported from `src/index.ts` (see §4) so library consumers can call `runStatus` programmatically and branch on the same shape the CLI emits in `--json` mode.

#### Comparison semantics

- **Never-synced** is checked first, before any network call. A source whose destination directory does not exist, or whose `.maester-source.json` is absent or schema-invalid, is reported as `behind` with reasons `["never-synced"]`. No `ls-remote` and no manifest probe are attempted for that source — short-circuiting saves a network round-trip and avoids exercising auth for a source the user clearly has not materialized yet.
- **Remote-ref-advanced** compares `resolvedSha` (from `ls-remote`, or from `source.ref` itself when the ref is a pinned 40-char SHA — see Gap 26) to `marker.commitSha`. Inequality in either direction is the signal; the architecture does not ask "is the upstream strictly newer in graph order" — any difference counts as drift.
- **Manifest-changed** applies only to manifest-driven sources (`source.includes` unset). The probe fetches the remote `maester.yaml`, extracts `documents[].path`, normalizes it to a **sorted, deduplicated set**, and compares to `marker.filterSet` normalized the same way. A cosmetic re-order of the remote `documents:` block does not trip the signal — only an additive, subtractive, or substantive change does. Sync's existing element-wise `filterSetMatches()` in `src/core/sync/provenance.ts` is unchanged; the two semantics are intentional (see Gap 24).
- A source can be `behind` with **multiple reasons** in a single run. `never-synced` is always alone; the other two can co-occur. Reasons are emitted in fixed order — `remote-ref-advanced` before `manifest-changed` — so output is deterministic.

#### Exit-code semantics

| Exit | Condition |
|---|---|
| `0` | Every checked source is `up-to-date`. |
| `1` | At least one source is `behind` and zero are `failed`. |
| `2` | At least one source is `failed`, **or** the run could not start (missing config, malformed YAML, invocation outside a citadel, scope name unknown). |

Failure takes precedence over behind: if both occur in the same run, exit code is `2` so the user notices the unreachable source instead of being lulled by a "just out of date" signal. Status's ladder is one rung deeper than sync's (sync remains `0` / `1`); both are documented in `--help`.

#### Side-effect contract

Status writes exactly **nothing** to the citadel destination directories, the persistent cache at `.maester/cache/`, the provenance markers, or the user's `.gitignore`. The only filesystem touch is the ephemeral temp directory `.maester/.status-<rand>/` used by `probeManifest`, which is removed in a `try/finally` regardless of success or failure. The temp dir sits under `.maester/`, which is already covered by the line init appends to `.gitignore` (see [Gap 3](#gap-3--local-clone-cache-location)) — no new `.gitignore` change is needed.

The destination-clobber guard ([Gap 6](#gap-6--destination-clobber-guard-before-any-sync-has-run)) does not apply to status because status never writes to a destination. The `--json` redaction rules from §7 (no secrets, no embedded tokens in URLs or error messages) apply identically to status output.

### 6.10 Grand Maester Skill

[Grand Maester Skill](features/grand-maester-skill.md) installs agent-specific integration artifacts into the citadel repository so a host AI agent (Claude Code, Codex CLI, Cursor, or any agent that reads a project-root `AGENTS.md`) reasons over citadel content with three baked-in behaviors: citadel awareness, canon-preferring state awareness, and pre-read freshness checks. The architecture splits cleanly into three pieces — an installer that writes artifacts, per-target writers that own each agent's conventions, and a runtime helper that the active-runtime targets (currently only Claude Code) invoke.

#### Target abstraction

`src/core/skill/targets/index.ts` exposes a registry of target descriptors:

```ts
type SkillTargetId = "claude-code" | "codex" | "cursor" | "agents-md";

type SkillTarget = {
  id: SkillTargetId;
  label: string;                          // Human-readable name shown in pickers
  artifactPaths: readonly string[];       // Repo-relative paths this target writes
  write: (input: SkillWriteInput) => Promise<SkillWriteOutcome>;
};
```

The v1 registry contains four targets:

| Target id | Label | Artifact path(s) |
|---|---|---|
| `claude-code` | Claude Code | `.claude/skills/grand-maester/SKILL.md` + a managed `maester` key in `.claude/settings.json` |
| `codex` | Codex CLI | `AGENTS.md` at the repo root (managed region) |
| `cursor` | Cursor | `.cursor/rules/grand-maester.mdc` |
| `agents-md` | Generic `AGENTS.md` | `AGENTS.md` at the repo root (managed region) |

Codex CLI and Generic `AGENTS.md` are exposed as **separate target identifiers** so each appears in the picker, but both delegate their write to a single shared writer (`src/core/skill/templates/shells/agents-md.ts`). The installer deduplicates by output artifact path before invoking writers — selecting both targets in one run produces exactly one `AGENTS.md` and exactly one write. The install outcome still lists both target ids so the user understands which agents are now covered. See Gap 27.

#### Managed-region conventions

Every artifact carries an idempotent managed region so upgrades can refresh content without clobbering anything the user has added outside it:

- **Markdown / `.mdc`** (`SKILL.md`, `AGENTS.md`, Cursor rule): HTML-comment markers — `<!-- maester:skill:begin v=<SKILL_VERSION> -->` and `<!-- maester:skill:end -->`. The reader extracts the version from the begin tag. The writer touches only what is between the markers; everything before the begin marker and after the end marker is left exactly as the user wrote it. When the file does not yet exist, the writer creates it with only the managed region plus a one-line preamble explaining what the file is.
- **`.claude/settings.json`**: a dedicated top-level `"maester"` object with an embedded `"version"` field and a `"hooks"` array. The writer reads, mutates, and re-serializes only that key; every other top-level field in `settings.json` is preserved byte-for-byte (round-tripped through a JSON parser that preserves key order). When the file does not exist, the writer creates it with just the `maester` block.

Both writers are idempotent — running install twice against an up-to-date target produces byte-identical output. See Gap 31.

#### Versioning

`src/core/skill/version.ts` exports a `SKILL_VERSION` constant whose value is the `version` field from `package.json`, resolved at build time via `src/package-meta.ts`. Each artifact embeds that version in its begin marker (Markdown) or `maester.version` field (JSON). On `maester skill upgrade`, the runner reads the marker out of each installed artifact, compares with the running `SKILL_VERSION`, and refreshes any target whose marker is older. `--check` reports the diff and exits non-zero without writing. The constant is not a separate "skill version" — it tracks `maester` itself so upgrade detection lines up exactly with package upgrades. See Gap 32.

#### Templates: shells + content

Long-form instruction prose lives as `.md` files under `src/core/skill/templates/content/`:

```
templates/content/
├── citadel-awareness.md         # Where citadel content lives, how it is organized
├── state-awareness.md           # Canon-preferring, draft-tolerant policy
└── freshness-awareness.md       # When to run `maester status`; how to react
```

Per-target shells under `src/core/skill/templates/shells/` (TypeScript modules) compose those fragments into the final artifact with format-specific scaffolding — front matter / preamble, managed-region markers, dynamic substitutions (`baseDir`, `SKILL_VERSION`, etc.). The `agents-md.ts` shell is shared by both the `codex` and `agents-md` targets. `tsup` bundles the `.md` files as text via a `loader: { '.md': 'text' }` config entry (declared in `tsup.config.ts`); at runtime the shells receive the fragments as plain string imports — no filesystem reads from the published package. See Gap 30.

#### Standalone CLI surface

`src/cli/commands/skill.ts` registers a `skill` subcommand group on the root Commander program. Verbs:

| Verb | Behavior |
|---|---|
| `install` | Interactive multi-select target picker when no flags; `--target <id>` (repeatable) selects targets non-interactively. Refuses to write when invoked outside a citadel-bearing repository (exit `2`). Writes are idempotent; running `install` against already-installed targets is a no-op. |
| `upgrade` | Refreshes every installed target's managed region to match `SKILL_VERSION`. `--check` reports the diff and exits non-zero (exit `1`) when any target is outdated without writing. |
| `add-target <id>` | Adds a target alongside any already installed. Equivalent to `install --target <id>` against an already-installed skill. |
| `status` | Lists installed targets with their on-disk version markers and an up-to-date / outdated verdict. Exit `0` when every installed target matches `SKILL_VERSION`. Exit `1` when at least one is outdated. Exit `2` when no targets are installed. |
| `runtime preread` | Internal — see §6.10.2 below. Reads a Claude Code hook envelope from stdin; emits a hook response envelope on stdout. |
| `runtime status-summary` | Internal — one-line human summary derived from `runStatus()`; exit-code ladder mirrors `maester status`. |

`runtime` verbs are intentionally namespaced under `skill` (not promoted to top-level) so the install surface and the agent-facing surface evolve together. They are documented in `--help` but framed as internal — typical users do not invoke them directly. See Gap 29.

#### Init walkthrough integration

The citadel-init flow ends with a single opt-in step, recommended-by-default per [Grand Maester Skill P0](features/grand-maester-skill.md):

```
  Install the Grand Maester agent skill? (Y/n) ▸ y
  
  Choose one or more agent targets
  
    ◉  Claude Code
    ◉  Codex CLI
    ◯  Cursor
    ◯  Generic AGENTS.md
  
  space toggle · ↵ continue
```

Accepting calls `runSkillInstall(repoRoot, { targets, mode: "install" })`, the same entry the standalone command uses. Declining leaves zero artifacts written. The prompt appears only when init is otherwise going to succeed — it is not asked on cancellation paths. The skill install is the very last step of init so a cancellation here still leaves a valid citadel config in place. See [Grand Maester Skill P0 — "Install at init"](features/grand-maester-skill.md#4-capabilities).

#### 6.10.1 Install / upgrade flow

```mermaid
sequenceDiagram
    actor U as User
    participant CLI as src/cli/commands/skill.ts
    participant Runner as src/core/skill/runner.ts
    participant Reg as src/core/skill/targets/index.ts
    participant Writers as targets/<id>.ts
    participant MR as src/core/skill/managed-region.ts
    participant FS as Filesystem

    U->>CLI: maester skill install [--target id ...]
    CLI->>Runner: runSkillInstall(repoRoot, { targets, mode })
    Runner->>Reg: lookup(targets) -> SkillTarget[]
    Runner->>Runner: dedupe by artifactPaths (codex + agents-md -> one writer)
    loop For each selected writer
        Runner->>Writers: write({ repoRoot, skillVersion, citadelBaseDir })
        Writers->>FS: read existing artifact (if any)
        Writers->>MR: parse existing managed region (extract installed version)
        Writers->>MR: rebuild managed region with SKILL_VERSION + content
        Writers->>FS: write artifact (idempotent; byte-identical if unchanged)
        Writers-->>Runner: SkillInstallOutcome { id, artifactPath, action }
    end
    Runner-->>CLI: SkillInstallResult { outcomes, counts }
    CLI->>U: human-readable summary listing every target by id and label
    Note over CLI: exit 0 on success; exit 2 if not a citadel-bearing repo
```

`SkillInstallOutcome.action` is one of `installed` (no prior artifact), `upgraded` (prior artifact present, version differed), `unchanged` (prior artifact present, content byte-identical), or `failed` (with an `error` field). The runner never throws on a single-target failure; the per-target outcome carries the error. Exit code is `0` when every outcome is `installed` / `upgraded` / `unchanged`, `1` when at least one is `failed`, `2` for invocation errors.

#### 6.10.2 Claude Code runtime hook

Claude Code is the only v1 target with active runtime — the others are instruction-only and rely on the host agent to honor the artifact text. On Claude Code, the freshness check is wired as a `PreToolUse` hook scoped to citadel reads. The hook entry written to `.claude/settings.json` under the managed `maester` key:

```json
{
  "maester": {
    "version": "<SKILL_VERSION>",
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "Read|Glob|Grep",
          "hooks": [
            { "type": "command", "command": "npx -y baller-maester skill runtime preread" }
          ]
        }
      ]
    }
  }
}
```

Why `npx -y baller-maester`: invocation is portable across machines whether `baller-maester` is a `devDependency` or globally installed, and self-updates on the next `npm publish`. The `-y` flag skips npx's first-run confirmation, which would otherwise stall the hook. The hook script reads Claude Code's tool-call envelope from stdin (the standard hook contract), so `npx --no-install baller-maester ...` and locally-resolved binaries both work without environment-specific adjustment.

The runtime flow:

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Hook as maester skill runtime preread
    participant Cache as .maester/.skill-cache.json
    participant Status as src/core/status/runner.ts
    participant Remote as Git remote

    CC->>Hook: stdin = { tool_name, tool_input.file_path, ... }
    Hook->>Hook: resolve path vs citadel baseDir
    alt path outside citadel baseDir
        Hook-->>CC: exit 0; stdout = "" (no additionalContext)
    else path inside citadel
        Hook->>Cache: read last-check timestamp
        alt within debounce TTL (default 300s; MAESTER_SKILL_STATUS_TTL override)
            Hook->>Hook: reuse cached verdict
        else stale or absent
            Hook->>Status: runStatus(config, { scope: null })
            Status->>Remote: ls-remote / manifest probes
            Remote-->>Status: SHAs + manifests
            Status-->>Hook: StatusResult
            Hook->>Cache: write { ts, counts, verdict } atomically
        end
        alt verdict = up-to-date
            Hook-->>CC: exit 0; stdout = {} (empty envelope)
        else verdict = behind | failed
            Hook-->>CC: exit 0; stdout = { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "Citadel is behind: <summary>. Run `maester sync` to refresh." } }
        end
    end
```

The hook always exits `0` and never blocks the tool call — its job is to inform the agent, not to gate the read. The decision to sync remains with the agent (which surfaces it to the user) and the user (who runs sync). The debounce cache is a tiny JSON file at `.maester/.skill-cache.json` covered by the same `.maester/` line init appends to `.gitignore`; no new ignore entries are required. See Gap 28.

#### Runtime helper output contract

`maester skill runtime preread` and `maester skill runtime status-summary` are versioned interfaces:

```ts
// preread response (Claude Code hook envelope) — emitted on stdout
type PrereadResponse =
  | {}                            // no-op
  | {
      hookSpecificOutput: {
        hookEventName: "PreToolUse";
        additionalContext: string;
      };
    };

// status-summary stdout — one line, human-readable
// e.g. "✓ all 3 sources up to date" | "! 1 source behind: docs (remote-ref-advanced)"
```

Both helpers emit nothing on stdout when there is nothing to say; any logging goes to stderr. The structured `preread` response is intentionally minimal (only the Claude Code envelope shape), so a host-agent upgrade that adds fields to the hook protocol can be accommodated without changing installed artifacts. Hook scripts written against the v1 contract ignore unknown fields, so additive future changes remain non-breaking. See Gap 33.

#### What the skill installer never does

- It never writes secret values to disk. The installed artifacts carry only the citadel's structural hints (the `baseDir`, the `maester` CLI invocation), never the citadel's source URLs and never any token value.
- It never modifies `gspec/`, the citadel config, the maester config, or any source content. Skill artifacts live in agent-specific locations only.
- It never installs the host agent. The user is responsible for having Claude Code, Codex CLI, or Cursor available; the installed artifacts have no effect on a machine without the corresponding agent.
- It never gates tool calls or blocks reads. Even on Claude Code, the hook is informational — exit `0` always.

### 6.11 Traveling Maesters (MCP framework)

[Traveling Maesters](features/traveling-maesters.md) introduces a second mode of citadel entry — **connectors** — that surfaces live data from external services to AI agents through the **Model Context Protocol**. Maester ships a stdio-based MCP server (`maester mcp`) built on `@modelcontextprotocol/sdk` (Gap 34). The server reads `citadel.yaml` at startup, instantiates every configured connector via the compile-time type registry, and exposes each operation as an MCP tool. The same per-connector dispatch is also reachable through a P1 **fallback CLI** (`maester connector exec <name> <op>`) for non-MCP agent hosts (Gap 36); both surfaces emit the §4 envelope.

#### Type registry

`src/core/connectors/registry.ts` is the only module in the framework that imports per-type implementations. Adding a new connector type is purely additive: a `types/<id>/index.ts` module exports a `ConnectorType`, and the registry's map gains one entry.

```ts
// src/core/connectors/registry.ts
import { gitlabIssuesType } from "./types/gitlab-issues/index.js";

export const CONNECTOR_TYPE_REGISTRY = {
  "gitlab-issues": gitlabIssuesType,
} as const satisfies Record<string, ConnectorType>;
```

Citadel-config validation (`src/schemas/citadel.ts`) consults this registry in a `.superRefine` to validate each `connectors[i].config` against the registered type's `configSchema` and to reject references to unknown types with a field-named error (Gap 40).

#### Tool naming

The MCP tool name for `(connector, operation)` is built by `src/core/connectors/tool-name.ts.toolName()`:

```
toolName({ name: "team-gl" }, { name: "list-issues" })
  -> "team_gl__list_issues"
```

Rules (Gap 37): both halves are lowercased; every `-` becomes `_`; the two halves are joined with `__`; the result is validated against `^[a-z][a-z0-9_]*$` at registration time (a violation is a programmer error, not a config error). The same function is used by `maester connector list` so humans see the exact name the agent will see.

#### Tool descriptions and input schema

Each type owns a `describeTool(operation, resolvedConfig)` function that returns a per-tool description string (e.g., `"List GitLab issues for project my-group/my-project on gitlab.acme.internal..."`). The framework prepends the connector entry's `description` (if set) so a maintainer can add team-specific context — that composition is in `src/core/connectors/dispatch.ts.buildToolDescription()`, not in any per-type module.

Each operation's `argsSchema` is a zod schema; `src/core/connectors/input-schema.ts` converts it to JSON Schema via `zod-to-json-schema` (Gap 38), pinned to a minimal subset (no `$defs`, no `$ref`) so every MCP host parses it the same way. This is the `inputSchema` field on every entry in `tools/list`.

#### Dispatch (the single chokepoint)

`src/core/connectors/dispatch.ts.invokeOperation(connector, operation, args, env)` is the only call path that runs a connector handler. Both the MCP server and the fallback CLI go through it:

```mermaid
sequenceDiagram
    actor U as Developer
    participant Host as Agent host (MCP client)
    participant Server as src/core/mcp/server.ts
    participant Disp as src/core/connectors/dispatch.ts
    participant Auth as src/core/auth/resolver.ts
    participant Type as types/<type>/operations.ts

    U->>Host: "list open GitLab issues"
    Host->>Server: tools/call { name: "team_gl__list_issues", arguments: {...} }
    Server->>Disp: invokeOperation(connector, "list-issues", args)
    Disp->>Disp: argsSchema.parse(args) → invalid-argument on failure
    Disp->>Auth: resolveAuth(connector.auth, env) → missing-env-var on failure
    Disp->>Type: handler({ config, token, args })
    Type-->>Disp: { data } | throw ConnectorError
    Disp-->>Server: { ok: true, data } | { ok: false, error }
    Server-->>Host: tool result content block (envelope JSON) | isError + envelope JSON
    Host-->>U: agent's answer
```

The dispatcher catches every error path and wraps it in the §4 envelope. Connector exceptions that do not derive from `ConnectorError` are caught, logged to stderr, and returned as `internal-error` envelopes (Gap 44). The server **never** crashes on a single failed tool call.

The fallback CLI follows the same shape but with one process per call: `src/cli/commands/connector.ts` loads `citadel.yaml`, calls `invokeOperation()`, writes the envelope JSON to stdout, exits with the appropriate code.

#### MCP server lifecycle

```mermaid
sequenceDiagram
    participant Host as Agent host
    participant CLI as src/cli/commands/mcp.ts
    participant Boot as src/core/mcp/server.ts
    participant Reg as src/core/connectors/registry.ts
    participant SDK as @modelcontextprotocol/sdk

    Host->>CLI: spawn `npx baller-maester mcp` (per .mcp.json)
    CLI->>Boot: bootMcpServer(repoRoot)
    Boot->>Boot: loadCitadelConfig(repoRoot) → throw on invalid → exit 2
    Boot->>Reg: lookupType(connector.type) for each connector → throw on unknown
    Boot->>Boot: build tool list (name, description, inputSchema)
    Boot->>SDK: new Server({ name: "maester", version }); register handlers
    Boot->>SDK: server.connect(StdioServerTransport)
    Note over Host,Boot: ──── handshake ────
    Host->>SDK: initialize
    SDK-->>Host: capabilities { tools: {} }
    Host->>SDK: tools/list
    SDK-->>Host: built tool list
    loop For each developer question that triggers a tool
        Host->>SDK: tools/call
        SDK->>Boot: invokeOperation(...)
        Boot-->>SDK: envelope content block
        SDK-->>Host: result
    end
    Host->>SDK: close stdio
    SDK-->>Boot: shutdown signal → exit 0
```

Lifecycle invariants (Gap 47):

- The server reads `citadel.yaml` **once at startup**. Live reload is out of scope; mid-session connector changes require the host platform to restart the server (most hosts restart automatically when their MCP config file changes).
- Validation is all-or-nothing: a malformed `citadel.yaml`, an unknown `type`, or a per-type config that fails its validator causes a non-zero exit **before** any MCP frames are exchanged. The server never exposes a partial tool surface.
- Individual tool-call failures return envelopes; they never crash the server.
- The process exits cleanly when its stdio peer closes the channel.

#### Stdout discipline

`stdout` belongs exclusively to the `@modelcontextprotocol/sdk` transport (Gap 41). `src/core/mcp/transport.ts` reconfigures the project's `consola` logger to write only to stderr before the SDK is constructed, so anything that uses the shared logger (config-load errors, connector-runtime warnings) lands on stderr where the host platform expects diagnostics. The `--json` mode and prompt layers are unconditionally disabled when `maester mcp` runs.

#### Per-host MCP server registration

`src/core/mcp/registrations/` writes the `maester` MCP server entry into each agent host's project-level config (Gap 39). One writer per host, dispatched by `index.ts` based on which Grand Maester targets are installed:

| Host | File path | Entry shape |
|---|---|---|
| Claude Code | `<repo-root>/.mcp.json` | JSON. Managed `"maester"` key inside `mcpServers` with `command = "npx"`, `args = ["-y", "baller-maester", "mcp"]`. The writer round-trips other `mcpServers` entries byte-for-byte. |
| Cursor | `<repo-root>/.cursor/mcp.json` | Same JSON shape as Claude Code. Cursor adopted Anthropic's project-MCP convention. |
| Codex CLI | `<repo-root>/.codex/config.toml` | TOML. Managed `[mcp_servers.maester]` block with `command = "npx"` and `args = ["-y", "baller-maester", "mcp"]`. Codex reads project-local `.codex/config.toml` for trusted projects (`[projects."<repo-root>"] trust_level = "trusted"` in `~/.codex/config.toml`) and merges it with the user-global file — verified on Codex CLI v0.132. No absolute paths are embedded, so the file is portable and safe to commit. Round-tripped with `@iarna/toml` (added to the stack — Gap 39) so the writer preserves other tables. |

All three writers embed the standard MCP-ecosystem launch convention: `command = "npx"`, `args = ["-y", "baller-maester", "mcp"]`. The `-y` flag skips npx's first-run confirmation that would otherwise stall the MCP handshake. The package name is `baller-maester`; `maester` is the bin name inside that package, and `mcp` is the maester subcommand that launches the stdio server. This shape is portable across machines (no absolute paths), self-updates when `baller-maester` is republished (npx resolves the latest cached version on next spawn), and works for users who never install globally at all.

Each writer uses the same managed-region discipline as the existing Grand Maester `.claude/settings.json` writer: a dedicated top-level key (or named TOML block) is read, mutated, and re-serialized, while every other top-level key is preserved byte-for-byte. Idempotent — running registration twice produces byte-identical files. The Generic `AGENTS.md` Grand Maester target is **not** an MCP host; its installed artifact instead documents the fallback CLI.

#### Init walkthrough placement

The citadel-init flow gains a single optional step between source registration and the Grand Maester offer (Gap 42):

```
  ✓  Sources configured (3 entries)

  Register a traveling maester (connector)? (Y/n) ▸ n
  
  …continues to Grand Maester offer…
```

Accepting opens a sub-flow that loops:

1. Pick a connector type (today: only `gitlab-issues`).
2. Enter a unique connector name (validated against `Connector.name` slug rules and uniqueness within `connectors`).
3. Optional description.
4. Auth env-var name (validated for the same name-vs-value heuristic used by source auth in §7).
5. Per-type config prompts (each type's module owns its prompt sequence).

After the loop, when the user also accepts the Grand Maester offer for one or more MCP-capable targets, init writes the MCP server registration into each target's config file in the same pass. Skipping the connector step completes init normally with an empty `connectors` array.

#### Grand Maester integration

Grand Maester install/upgrade extends to:

1. Write/refresh the MCP server registration for each MCP-capable target via `src/core/mcp/registrations/index.ts`.
2. Compose a fixed **connector-policy paragraph** into each per-target shell's managed region (Gap 43). The paragraph is a content fragment at `src/core/skill/templates/content/connector-policy.md`:
   > *"This citadel exposes one or more **traveling maesters** as MCP tools whose names begin with the connector slug (e.g. `team-gl__list-issues`). Their output is **live, point-in-time data** — cite specific identifiers (issue iids, ticket numbers) when surfacing it, do not treat it as a stable corpus, and flag the **freshness verdict** in your answer when it is not `up-to-date`. The tools' arguments and shapes are described in MCP `tools/list`; do not assume undocumented fields."*
3. Skip enumeration entirely. The list of configured connectors is never written into the installed artifacts — MCP `tools/list` is the canonical surface (Gap 43).

The Generic `AGENTS.md` target receives a parallel content fragment (`templates/content/connector-policy-fallback.md`) that documents the fallback CLI surface instead, with sample invocations.

#### Refresh on connector mutations

`maester connector add` and `maester connector remove` end by calling `refreshMcpRegistrations(repoRoot)` (Gap 46), which iterates installed Grand Maester targets and rewrites each host's managed MCP entry from the updated citadel config. The final stdout lists which hosts were updated and reminds the user that their next agent session will pick up the new tool surface.

### 6.12 GitLab Issues Connector

[GitLab Issues Connector](features/gitlab-issues-connector.md) is the v1 reference connector type. It lives entirely under `src/core/connectors/types/gitlab-issues/` and is registered with the framework as `gitlab-issues`.

#### Module layout

| File | Responsibility |
|---|---|
| `index.ts` | Exports `gitlabIssuesType: ConnectorType` — wires together schema, operations, `describeTool`. The only module the registry imports. |
| `schema.ts` | Per-type config (`host`, `project`, `apiVersion`). `.strict()` zod schema. |
| `client.ts` | Thin native-`fetch` facade over `${host}/api/v4/projects/:project/issues...` (Gap 35). Encodes the `project` path, sets the `PRIVATE-TOKEN` header, parses JSON, hands raw status + body back to the caller. ~150 LOC. Zero new runtime deps. |
| `operations.ts` | The two operation handlers: `listIssues(args, ctx)` and `getIssue(args, ctx)`. Each calls `client.ts`, maps GitLab outcomes onto the framework error codes via `errors.ts`, and returns the success/data shape. |
| `output.ts` | The `IssueOutput` shape, the list-result `meta` shape, and the per-type `dataSchema: 1` constant. Single chokepoint so output stays stable. |
| `errors.ts` | `mapGitLabStatus(status, body) -> ConnectorError`. Maps 401/403→`auth-failed`, 404→`remote-error/not-found`, 429→`remote-error/rate-limited` (preserving any `Retry-After`), 5xx/transport→`remote-error/transport`, unexpected→`remote-error/unexpected` with a truncated `body` excerpt. |

#### Project path/ID interpretation

The `project` value is interpreted at the client level (Gap 45):

```ts
const segment = /^\d+$/.test(project)
  ? project                              // numeric ID — passed verbatim
  : encodeURIComponent(project);         // path — URL-encoded
const url = `${host}/api/v4/projects/${segment}/issues`;
```

Validation runs at config-load time (`schema.ts`) — empty / whitespace values are rejected.

#### Auth

The connector entry's `auth.envVar` is read by `src/core/auth/resolver.ts` at the moment of each tool call (not at server startup), so token rotation is picked up on the next call within a single MCP session — subject to the host platform's process-environment caching, which typically means the next agent-session restart guarantees rotation pickup. The env-var **name** is the only thing that ever appears in error messages; the value never is.

#### Tool descriptions

`describeTool` reads the resolved config and renders a per-operation string. Examples for `name: "team-gl"`, `host: "https://gitlab.acme.internal"`, `project: "my-group/my-project"`:

| Tool | Description |
|---|---|
| `team_gl__list_issues` | `"List GitLab issues for project my-group/my-project on gitlab.acme.internal. Supports filtering by state, labels, assignee, milestone, free-text search, and page/per_page pagination. Returns at most 100 issues per call."` |
| `team_gl__get_issue` | `"Fetch a single GitLab issue from project my-group/my-project on gitlab.acme.internal by its project-scoped iid. Returns the issue's title, description, state, labels, assignees, milestone, timestamps, and web_url."` |

If the connector entry carries a `description`, the framework prepends it: `"App team's GitLab. Use for customer-facing API questions. List GitLab issues for ..."`. This composition lives in `src/core/connectors/dispatch.ts`, not in the type module.

#### Input schemas (excerpt)

```ts
// operations.ts (illustrative)
const listIssuesArgsSchema = z
  .object({
    state: z.enum(["opened", "closed", "all"]).default("opened"),
    labels: z.string().optional(),
    assignee: z.string().optional(),
    milestone: z.string().optional(),
    search: z.string().optional(),
    page: z.number().int().positive().default(1),
    per_page: z.number().int().positive().max(100).default(20),
  })
  .strict();
```

The framework's `src/core/connectors/input-schema.ts` converts this to JSON Schema for `tools/list.inputSchema`. The `per_page` cap of 100 (GitLab's documented maximum) is enforced both by the zod schema (configured rejection) **and** by the client (defensive clamp with a `meta.clamped` flag in the result), per the PRD's "values above the cap clamp to 100" requirement.

#### Pagination meta

The list result wraps the issue array in:

```jsonc
{
  "dataSchema": 1,
  "issues": [/* IssueOutput[] */],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total_pages": 7,    // null when GitLab omits the header
    "total": 132,        // null when GitLab omits the header
    "clamped": false     // true iff per_page was clamped to 100
  }
}
```

`null` is used (not omission) for the totals fields so the schema shape is stable across GitLab versions that do and do not return the totals headers.

---

## 7. Authentication & Authorization Architecture

The application has no in-process authorization layer. It operates with the invoking user's filesystem permissions and the credentials their environment grants to outbound operations. The authentication surface has **two** symmetric kinds of entry, both routed through the single `src/core/auth/resolver.ts` chokepoint and both using the same `AuthRef` discriminated union, the same env-var resolution path, and the same redaction rules:

- **Sources** — every source uses the same `AuthRef`, regardless of whether the source is manifest-driven or includes-driven, and regardless of whether the caller is `maester sync` (which materializes content) or `maester status` (which does not). The resolved token is injected into the git operation that guards it (`clone` + `fetch` for sync, `ls-remote` + a one-blob sparse-checkout for status — see §6.9).
- **Connectors** — every connector uses the same `AuthRef` shape, resolved at MCP-tool-invocation time (not at server startup). The resolved token is handed to the per-type client (e.g., the GitLab client's `PRIVATE-TOKEN` header) by `src/core/connectors/dispatch.ts` and is dropped after the call. A missing or empty env var produces the framework's `missing-env-var` envelope before any network call (§4 → §6.11); the env-var **name** appears in error messages, the **value** never does.

Both kinds of entry obey the same secret-handling rules (§7 below). The remainder of this section describes those rules; they apply uniformly to sources and connectors.

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
| `<user-defined>` (source auth) | Conditional | Each source with `auth.type === "token"` requires the env var whose name appears in its config. Variable names are user-chosen; common form is `MAESTER_<NAME>_TOKEN`. | `MAESTER_DOCS_TOKEN=ghp_xxx` |
| `<user-defined>` (connector auth) | Conditional | Each connector with `auth.type === "token"` requires the env var whose name appears in its config. Read by the MCP server at invocation time (and by the fallback CLI at process start). Common forms: `GITLAB_TOKEN`, `MAESTER_<CONNECTOR>_TOKEN`. | `GITLAB_TOKEN=glpat-xxx` |
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
| `<repo-root>/.claude/skills/grand-maester/SKILL.md` | n/a (managed Markdown w/ managed-region markers) | Grand Maester skill installer (Claude Code target) | Claude Code at runtime. Committed; not gitignored. |
| `<repo-root>/.claude/settings.json` (managed `maester` key only) | n/a (JSON w/ a managed top-level key) | Grand Maester skill installer (Claude Code target) | Claude Code at runtime. Committed (project-level settings); `.claude/settings.local.json` remains the user-local file and is untouched by the installer. |
| `<repo-root>/AGENTS.md` (managed region) | n/a (Markdown w/ managed-region markers) | Grand Maester skill installer (Codex CLI and/or generic targets) | Any host agent that reads project-level `AGENTS.md`. Committed; not gitignored. |
| `<repo-root>/.cursor/rules/grand-maester.mdc` | n/a (Markdown w/ managed-region markers) | Grand Maester skill installer (Cursor target) | Cursor at runtime. Committed; not gitignored. |
| `<repo-root>/.maester/.skill-cache.json` | n/a (small JSON cache) | Grand Maester runtime hook (Claude Code) | Same hook. Lives under `.maester/`, already covered by the line init appends to `.gitignore`. |
| `<repo-root>/.mcp.json` (managed `mcpServers.maester` key only) | n/a (JSON w/ a managed key) | `maester connector add/remove` + Grand Maester install (Claude Code target) | Claude Code at session start (also picked up by Cursor on hosts that read this path). Committed; not gitignored. Writer round-trips other `mcpServers` entries byte-for-byte. |
| `<repo-root>/.cursor/mcp.json` (managed `mcpServers.maester` key only) | n/a (JSON w/ a managed key) | `maester connector add/remove` + Grand Maester install (Cursor target) | Cursor at session start. Same shape as Claude Code's `.mcp.json`. Committed. |
| `<repo-root>/.codex/config.toml` (managed `[mcp_servers.maester]` block only) | n/a (TOML w/ a managed block) | `maester connector add/remove/refresh` + Grand Maester install (Codex CLI target) | Codex CLI at session start (project-local config loads on trusted projects). Round-tripped via `@iarna/toml` so other `[mcp_servers.<name>]` blocks are preserved. Committed; not gitignored. |
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
# one pass. Generated by `npx baller-maester init` and safe to commit. Secret
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

# Optional. Traveling maesters (connectors) expose live external data — issue
# trackers, ticket queues, chat — to AI agents as MCP tools served by
# `maester mcp`. Each connector is one (type, name) tuple plus a per-type
# `config` block. The env-var NAME of an auth credential is committed; the
# VALUE lives in your shell / .env / CI secret manager and is read at
# tool-invocation time. The agent host (Claude Code, Cursor, Codex CLI)
# discovers connector tools via standard MCP discovery — no enumeration
# needed in your agent instructions.
#
# Each connector exposes one MCP tool per operation, named
# `<connector_name>__<operation_name>` with hyphens converted to underscores
# (e.g. `team-gl` + `list-issues` -> `team_gl__list_issues`).
#
connectors:
  # GitLab Issues on gitlab.com (default host).
  - name: oss-gl
    type: gitlab-issues
    description: >
      Public GitLab project for the OSS library we depend on.
      Use when the user asks about upstream bugs or feature requests.
    auth:
      type: token
      envVar: OSS_GITLAB_TOKEN
    config:
      project: my-org/my-public-project

  # GitLab Issues on self-hosted GitLab Enterprise.
  - name: team-gl
    type: gitlab-issues
    description: App team's GitLab. Use for customer-facing API questions.
    auth:
      type: token
      envVar: GITLAB_TOKEN
    config:
      host: https://gitlab.acme.internal
      project: app-team/customer-api
```

### Example `maester.yaml`

```yaml
# maester.yaml
#
# This file declares the documents this repository publishes to any citadel
# that pulls from it. It is a manifest only — the documents themselves live
# wherever the `path` fields point, and `maester` does not modify them.
#
# Generated by `npx baller-maester publish` and safe to commit.

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
| `package.json` | Manifest. | `"type": "module"`, `"bin": { "maester": "bin/maester.mjs" }`, `"engines": { "node": ">=24" }`, `"sideEffects": false`. New runtime deps added by the connector framework: `@modelcontextprotocol/sdk` (MCP server runtime — Gap 34), `zod-to-json-schema` (operation `argsSchema` → JSON Schema — Gap 38), `@iarna/toml` (round-trippable TOML for `.codex/config.toml` — Gap 39). No new transitive HTTP-client deps; the GitLab type uses Node 24's native `fetch` (Gap 35). |
| `tsconfig.json` | TypeScript config. | `"target": "ES2023"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"verbatimModuleSyntax": true`. |
| `tsup.config.ts` | Build. | `entry: { index: "src/index.ts", "cli/main": "src/cli/main.ts" }`, `format: ["esm"]`, `dts: true`, `clean: true`, `target: "node24"`, `loader: { ".md": "text" }` (inlines `src/core/skill/templates/content/*.md` as raw string imports — see [Gap 30](#gap-30--skill-template-storage-hybrid-ts-shells--md-content)). |
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

**Resolution.** (User-confirmed.) Init detects `package.json` at the repo root. When present, init idempotently adds `"maester:sync": "maester sync"` to its `"scripts"` map (or leaves an existing identical entry untouched). Regardless of presence, init's final stdout always prints the canonical command — `npx baller-maester sync` — as a copy-pasteable instruction. No standalone shim script is written.

#### Gap 3 — Local clone-cache location

**What's missing.** [Maester Sync P0](features/maester-sync.md) says "the local fetch storage is treated as managed cache and is not expected to be committed" but does not name the path.

**Why it matters.** Init writes the cache path to `.gitignore` ([Citadel Initialization P1](features/citadel-initialization.md)); sync writes into the cache; tests need to clean it up.

**Resolution.** `.maester/cache/<source-name>/` at the repo root. (User-confirmed.) Init appends `.maester/` to `.gitignore` as a single line — covering both the clone cache and any other future tool state under `.maester/`.

#### Gap 4 — First-run detection for the welcome banner

**What's missing.** [CLI Banner P0](features/cli-banner.md) requires the banner on the "first-run welcome screen" and gives no detection mechanism.

**Why it matters.** Determines whether the CLI writes a state file and whether the banner shows once-per-repo, once-per-user, or every time a fresh repo opens the menu.

**Resolution.** (User-confirmed.) First-run is inferred from configuration presence: the welcome variant of the banner renders when `npx baller-maester` is invoked with no subcommand AND neither `citadel.yaml` nor `maester.yaml` exists at the repo root. Once either file exists, subsequent no-arg invocations show the top-level menu without the welcome variant. The `--help` and `--version` banner is unaffected.

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

#### Gap 22 — Status's remote query strategy

**What's missing.** [Citadel Status P0](features/citadel-status.md) requires checking whether each source is up-to-date, behind, or failed without materializing files into a destination, and explicitly assumes status does not mutate the local cache. The PRD names the signals (`never-synced`, `remote-ref-advanced`, `manifest-changed`) but not the git invocations that produce them.

**Why it matters.** Determines what status has to share with sync's `fetchSource()`, where the transient state goes, and whether a status run can leave disk state behind that affects the next sync.

**Resolution.** (User-confirmed.) Status uses `git ls-remote <url> <ref>` for commit-SHA resolution — no clone, no working tree, no cache mutation. For manifest-driven sources, `probeManifest` runs the same `--filter=blob:none --depth=1` partial clone + sparse-checkout that sync's Stage 1 uses, but against a **fresh temp directory** at `.maester/.status-<rand>/`, fetching only `maester.yaml`. The temp directory is removed in a `try/finally` regardless of success or failure. Sync's persistent cache at `.maester/cache/<name>/` is never read or written by status. Authentication for both probe paths threads through `src/core/auth/resolver.ts` exactly as sync does: an `AuthRef` of `type: "token"` is resolved against `process.env` at run time, injected into the HTTPS URL for the git operation, and redacted before any error message reaches stdout/stderr.

#### Gap 23 — Status's command surface and menu placement

**What's missing.** The top-level interactive menu (§6.1) has a placeholder labeled "Show status (summarize configured roles)" that predates [Citadel Status](features/citadel-status.md). The new feature introduces a `maester status` command whose name overlaps but whose intent is different — source freshness, not role listing.

**Why it matters.** Overloading "status" in two surfaces is a UX hazard. The architecture must commit to which menu entries exist and which commands they map to.

**Resolution.** (User-confirmed.) `maester status` is a CLI-only command — no menu entry runs it. The primary callers (CI jobs, AI agents, developers running pre-flight checks) all type the verb explicitly, and the structured `--json` output is built for non-interactive consumption. The existing "Show status (summarize configured roles)" menu entry stays as-is and remains a role-summary path; the two surfaces are kept conceptually distinct. If a future feature wants menu-driven freshness checks, that is a separate decision and PRD.

#### Gap 24 — Manifest-changed comparison semantics

**What's missing.** [Citadel Status](features/citadel-status.md) explicitly flags cosmetic edits to a remote `maester.yaml` (re-ordering `documents:`, whitespace, comments) as a false-positive risk for the `manifest-changed` signal. Sync's existing `filterSetMatches()` in `src/core/sync/provenance.ts` is element-wise and would treat a re-order as a real change.

**Why it matters.** A status verdict that flips between `up-to-date` and `behind` because a maintainer alphabetized the remote `documents:` block is a false positive — and agents will be especially noisy about it. The comparison must agree with the *resolved publish surface*, not the textual order.

**Resolution.** (User-confirmed.) Status performs **set-equality** on the filter sets: each side is sorted and deduplicated before comparison. Sync's existing element-wise `filterSetMatches()` is unchanged — its job is cache-invalidation completeness, where re-running Stage 2 on a re-ordered list is conservative but harmless. Two semantics coexist in the codebase, each correct for its caller. The set-equality helper lives in `src/core/status/runner.ts` and is **not** re-exported from `provenance.ts`, so neither caller is at risk of accidentally adopting the other's semantics. A test in `test/unit/core/status/runner.test.ts` asserts that a re-ordered remote manifest is reported as `up-to-date` even when sync's primitive would consider it changed.

#### Gap 25 — Status runner placement and code reuse with sync

**What's missing.** Status reuses the citadel config loader, the auth resolver, the git client, and the provenance reader. It does **not** reuse `fetchSource()`, because `fetchSource()`'s contract is to materialize a working tree at `.maester/cache/<name>/` — the side-effect status must avoid. The architecture has to commit to where the status pipeline lives so it does not entangle with sync.

**Why it matters.** Embedding status into `sync/runner.ts` would entangle two pipelines with different side-effect contracts. Reusing `fetchSource()` would force status either to accept the cache mutation or refactor sync, neither of which is justified by the feature's scope.

**Resolution.** Status lives in a sibling cluster `src/core/status/` (`runner.ts` + `probe.ts`). The runner imports `loadCitadelConfig`, `resolveAuth`, `readProvenanceMarker`, and a new minimal helper on `src/core/git/client.ts` (`listRemoteRef(url, ref, token?)`, wrapping `simple-git`'s `listRemote`). The manifest probe issues the same partial-clone + sparse-checkout primitives sync's fetcher uses, but against a fresh temp directory and with `maester.yaml` as the only sparse target — no Stage 2, no destination copy, no provenance write. Sync's code is **not** modified. If a future refactor wants to hoist common primitives (e.g. manifest-discovery) into a shared module under `src/core/sources/`, that work is out of scope for this feature.

#### Gap 26 — Pinned-SHA short-circuit and tag dereferencing

**What's missing.** When `source.ref` is a 40-character commit SHA, `git ls-remote` is not the right primitive — refs match by name, not by SHA. The architecture must say what status does in this case and, separately, how it handles annotated tags whose `ls-remote` output contains both the tag object SHA and the dereferenced commit SHA (`<sha> refs/tags/v1.2.3` and `<sha> refs/tags/v1.2.3^{}`).

**Why it matters.** Without a defined behavior, status would either always fail pinned sources, always report them as up-to-date, or quietly compare the wrong SHA for annotated tags.

**Resolution.**

1. **Pinned-SHA short-circuit.** When `source.ref` matches `^[0-9a-f]{40}$`, the probe does not call `ls-remote`. The "resolved SHA" is `source.ref` itself. The remote-ref-advanced check then degenerates to `provenance.commitSha === source.ref`: a match is `up-to-date`; a mismatch is correctly reported as `behind` with reason `remote-ref-advanced` (the citadel was synced at a different SHA than what the config now pins). The manifest-changed check still runs for manifest-driven pinned sources, because the pinned tree's manifest may still differ from what was recorded; the probe fetches `maester.yaml` at `source.ref` via the same partial-clone + sparse-checkout primitive.

2. **Annotated tag dereferencing.** `listRemoteRef(url, ref)` requests both `refs/tags/<ref>` and `refs/tags/<ref>^{}` and, when the peeled form is present, returns the **dereferenced commit SHA**. This matches what sync's existing `checkoutRef` resolves to (which calls `git rev-parse HEAD` after checking out the ref), so status and sync agree on the SHA for the same tag.

#### Gap 27 — AGENTS.md target dedup (Codex CLI vs generic)

**What's missing.** [Grand Maester Skill](features/grand-maester-skill.md) lists both **Codex CLI** and **Generic `AGENTS.md`** as v1 targets, but both consume the same `AGENTS.md` file at the repo root. Without a stated dedup rule, selecting both in one install could write the file twice (race) or list two unrelated outcomes for one artifact.

**Why it matters.** The picker presents two distinct labels because the user thinks of them as different agents; the filesystem sees one file.

**Resolution.** (User-confirmed.) The target registry exposes `codex` and `agents-md` as **separate target identifiers** so both appear in the install picker, but both delegate to a single shared writer at `src/core/skill/templates/shells/agents-md.ts`. The installer dedupes by output artifact path before invoking writers — selecting both targets in one run produces exactly one `AGENTS.md` and exactly one write call. The `SkillInstallResult` still reports an outcome for each selected target id (sharing the same `artifactPath`), so the summary line names both agents the install covers. The same dedup rule generalizes to any future targets that share an artifact path.

#### Gap 28 — Claude Code freshness hook scope

**What's missing.** [Grand Maester Skill P0](features/grand-maester-skill.md) requires that the freshness check runs "before substantial citadel reads" on platforms that support hooks. Claude Code supports both `SessionStart` (one check per session) and `PreToolUse` (check before each matching tool call); the architecture has to pick one and define the matching predicate.

**Why it matters.** A `SessionStart`-only hook is the cheapest network footprint but misses staleness that develops mid-session and pays an unconditional cost on session start even when the developer never reads citadel content. An unscoped `PreToolUse` hook would run `maester status` before every `Read` — wildly over-eager. A path-scoped `PreToolUse` hook is the only option that fires at the exact moment that matters without firing on routine non-citadel work.

**Resolution.** (User-confirmed.) `PreToolUse` hook with a `matcher: "Read|Glob|Grep"` and a path-scoping predicate inside the hook script:

1. The installed `.claude/settings.json` `maester.hooks.PreToolUse` entry invokes `npx -y baller-maester skill runtime preread`.
2. The hook script reads Claude Code's tool-call envelope from stdin, extracts `tool_input.file_path` (or the equivalent for Glob/Grep), and resolves it against `process.cwd()`.
3. The script reads the citadel config to derive the resolved `baseDir`. When the targeted path is **outside** the citadel base directory, the script exits `0` with empty stdout — no network call, no additionalContext, no visible side effect.
4. When the targeted path is **inside** the citadel, the script consults the debounce cache at `.maester/.skill-cache.json` (default TTL 300 s, configurable via `MAESTER_SKILL_STATUS_TTL`). On cache hit, it reuses the cached verdict. On cache miss or stale entry, it calls `runStatus()` and writes a new cache entry atomically.
5. On `up-to-date`, the script emits an empty hook response (`{}`). On `behind` or `failed`, it emits `{ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "..." } }` with a one-line summary and a pointer to `maester sync`. The script always exits `0` — it informs but never blocks the read.

The debounce cache is small and lives under the already-gitignored `.maester/` directory, so no new `.gitignore` entries are required (see [Gap 3](#gap-3--local-clone-cache-location)).

#### Gap 29 — Skill CLI verb shape

**What's missing.** The standalone management surface for the Grand Maester needs a stable command shape. The PRD names install / upgrade / add-target / switch-target as required verbs but does not commit to a verb grouping.

**Why it matters.** Top-level flat verbs (`maester install-skill`, `maester upgrade-skill`) balloon the `--help` list and leave no obvious home for runtime helpers. A group prefix keeps related verbs together and reserves namespace for future runtime helpers and per-target diagnostics.

**Resolution.** (User-confirmed.) `maester skill <verb>` as a Commander subcommand group on the root program. Verbs: `install`, `upgrade`, `add-target`, `status`, `runtime <op>`. The `runtime` namespace contains internal helpers invoked by installed hooks (`preread`, `status-summary`) — these are documented in `--help` but framed as internal; routine users do not type them. Future per-target diagnostics (e.g. `maester skill doctor`) hang off the same group without polluting top-level help. See §6.10.

#### Gap 30 — Skill template storage (hybrid TS shells + .md content)

**What's missing.** Skill artifacts mix long-form instruction prose (the agent-facing text) with format-specific structural scaffolding (managed-region markers, front matter, dynamic substitutions). Both could live as TypeScript template literals, both as `.md` files, or split. The architecture has to commit to a single approach so the bundler config is stable.

**Why it matters.** Pure TS template literals make the prose hard to author and lint (no markdown tooling, escape-character noise). Pure `.md` files lose the typed substitution surface and require runtime FS reads from the published package. The split shape preserves both editorial quality and typed assembly.

**Resolution.** (User-confirmed.) Hybrid:

- TypeScript "shell" modules at `src/core/skill/templates/shells/<id>.ts` own the per-target structural scaffolding (preamble, managed-region markers, dynamic substitutions like `baseDir` and `SKILL_VERSION`).
- Raw `.md` fragments at `src/core/skill/templates/content/<topic>.md` own the long-form instruction prose (`citadel-awareness.md`, `state-awareness.md`, `freshness-awareness.md`).
- The shells import the fragments as plain string exports. `tsup` is configured with `loader: { ".md": "text" }` (see [§8 → tsup.config.ts](#configuration-files-in-this-repository--the-package-itself)) so the bundler inlines the markdown content into the JS output at build time. At runtime the published package contains no `.md` files; the shells already have the content as in-memory strings.
- Editing instruction prose is a single-file change against an `.md` file; editing per-target structure is a single-file change against a `.ts` shell. The shared `agents-md.ts` shell is the only writer for both the `codex` and `agents-md` targets (see Gap 27).

#### Gap 31 — Managed-region marker conventions

**What's missing.** Every installed artifact must let `upgrade` refresh the maester-managed content without clobbering anything the user has added around it. The PRD names "managed region" as the convention but does not define the marker shape for each format.

**Why it matters.** Two distinct artifact formats are in play: Markdown (`.md`, `.mdc`) and JSON (`.claude/settings.json`). Their marker syntaxes have to be format-native or the writer will produce invalid files.

**Resolution.** Format-specific markers, defined in `src/core/skill/managed-region.ts`:

- **Markdown / `.mdc`.** Begin marker: `<!-- maester:skill:begin v=<SKILL_VERSION> -->` on its own line. End marker: `<!-- maester:skill:end -->` on its own line. The reader extracts `v=<...>` from the begin tag for upgrade comparisons. The writer rewrites only what is between the markers and preserves bytes before the begin marker and after the end marker exactly. When the file does not yet exist, the writer creates it with a one-line human preamble (explaining what the file is) followed by the managed region.

- **`.claude/settings.json`.** A dedicated top-level `"maester"` object key containing `{ "version": "<SKILL_VERSION>", "hooks": { ... } }`. The reader parses the JSON with a key-order-preserving parser, mutates only the `maester` key, and re-serializes. Every other top-level field — `permissions`, user-authored hooks not under `maester`, etc. — is preserved byte-for-byte (modulo whitespace produced by the formatter). When the file does not exist, the writer creates it with only the `maester` block.

Both writers are idempotent — running install twice against an up-to-date target produces byte-identical output, validated by a unit test asserting `writeArtifact(input) === writeArtifact(writeArtifact(input))`.

#### Gap 32 — Skill version source and propagation

**What's missing.** Each installed artifact embeds a version marker so `maester skill upgrade` can detect outdatedness. The architecture has to commit to where the version number originates so install and upgrade agree.

**Why it matters.** A drifting source of truth (e.g., a separate `skill-version` constant) would let install-time and upgrade-time disagree, producing spurious "outdated" reports. Tying the marker to a value that already ships with each release keeps the contract simple.

**Resolution.** `SKILL_VERSION` is a string constant exported by `src/core/skill/version.ts`, sourced at build time from `package.json` via the existing `src/package-meta.ts` reader. Every installed artifact embeds the value in its begin marker (Markdown) or `maester.version` field (JSON). On `maester skill upgrade`, the runner reads the marker out of each installed artifact, compares with the current `SKILL_VERSION`, and refreshes any target whose marker is older. `--check` reports the diff and exits non-zero (exit `1`) without writing. The constant does not track a separate "skill schema version" — it tracks `maester` itself so upgrade detection lines up exactly with package upgrades.

#### Gap 33 — Runtime helper output contract

**What's missing.** Installed Claude Code hook entries invoke `maester skill runtime preread`. The output shape that hook script writes to stdout is the contract between an installed artifact and the running `maester` CLI. Without versioning, future revisions of the helper could silently break artifacts installed under an older `maester`.

**Why it matters.** Claude Code's hook protocol expects a specific JSON response envelope; future Claude Code or `maester` revisions may want to add fields. The architecture has to commit to a contract that survives additive changes.

**Resolution.**

1. **`preread` stdout shape.** Either `{}` (no-op — exit `0` with empty body acceptable too) or `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "<one-line summary>" } }`. No additional top-level fields are introduced in v1. Hook scripts written against the v1 contract ignore unknown fields, so additive future fields remain non-breaking.

2. **`status-summary` stdout shape.** A single human-readable line written to stdout (e.g., `✓ all 3 sources up to date` or `! 1 source behind: docs (remote-ref-advanced)`). Exit-code ladder mirrors `maester status` (`0` / `1` / `2`).

3. **Side-channel discipline.** Both helpers emit nothing on stdout when there is nothing to say. Diagnostic logging (errors during config load, redacted network errors, etc.) goes to stderr so a hook caller can swallow stderr without losing the structured stdout response.

4. **No secret leakage.** The `--json` redaction rules from §7 (no embedded tokens in URLs or error messages) apply identically to the runtime helpers — `additionalContext` is built from `StatusOutcome` fields that have already passed sync's redactor.

#### Gap 34 — MCP server runtime (SDK choice)

**What's missing.** [Traveling Maesters](features/traveling-maesters.md) specifies a stdio-based MCP server but does not name a library. Two viable approaches: the official `@modelcontextprotocol/sdk` TypeScript package, or a hand-rolled JSON-RPC implementation.

**Why it matters.** The framework's wire-protocol behavior, capability negotiation, content-block schema, request-id handling, and protocol-version tracking all live in this layer. Choosing wrong forces either ~400-600 LOC we own and have to keep current with MCP revisions, or a dependency on an actively-evolving SDK whose API changes we'd have to track.

**Resolution.** (User-confirmed.) Use `@modelcontextprotocol/sdk` from npm. Rationale: it matches the existing stack pattern of preferring vendor-owned SDKs at integration boundaries (compare `simple-git`, `zod`, `@clack/prompts`); MCP is young enough that the upstream maintainers are the right party to track protocol changes; the cost is a single direct dependency. The MCP layer lives at `src/core/mcp/server.ts` and is a thin adapter around the SDK's `Server` class plus `StdioServerTransport`. We never frame JSON-RPC by hand.

#### Gap 35 — GitLab API HTTP client

**What's missing.** [GitLab Issues Connector](features/gitlab-issues-connector.md) does not name a library for talking to the GitLab REST API.

**Why it matters.** Choice ripples through dependency surface (`@gitbeaker/rest` adds ~250 KB transitive install), the error-mapping code, and the cost of future expansion to MRs / comments / pipelines.

**Resolution.** (User-confirmed.) Use Node 24's global `fetch` directly, wrapped in a thin typed facade at `src/core/connectors/types/gitlab-issues/client.ts`. Rationale: matches [stack.md](stack.md) §11 ("Native to Node 24+") and [practices.md](practices.md) §6 ("Minimize dependencies"); two endpoints with documented field shapes is exactly the case the rule was written for; we own ~150-200 LOC of HTTP plumbing in exchange for zero new runtime deps and full control over the HTTP-status-to-error-code mapping in `errors.ts`. Revisit if scope grows to many endpoints or mutations.

#### Gap 36 — Fallback CLI surface in v1

**What's missing.** [Traveling Maesters](features/traveling-maesters.md) marks the `maester connector <name> <op>` CLI surface as P1 — a "fallback for non-MCP agent platforms." The PRD does not say whether v1 implementation ships it or defers it.

**Why it matters.** Without the fallback, the Generic `AGENTS.md` Grand Maester target has no mechanism to invoke connectors, closing a door the framework PRD opened. With it, we maintain two front-ends over the same dispatch code.

**Resolution.** (User-confirmed.) Ships in the v1 implementation cut alongside the MCP server. Both front-ends call `src/core/connectors/dispatch.ts.invokeOperation()` — same code, two surfaces. Cost is roughly +150 LOC and +1 Commander subcommand in `src/cli/commands/connector.ts`. The fallback is also the natural unit-test entrypoint for connector implementations independent of MCP plumbing, so we get test ergonomics for free.

**Verb shape.** The PRD described the fallback as bare positional `maester connector <name> <op>`, but Commander v13's subcommand resolver cannot disambiguate that pattern from the sibling `add` / `remove` / `list` verbs (any first positional could be either a subcommand name or a connector name). The implementation ships an explicit verb — `maester connector exec <name> <op> [--key value]...` — keeping the parser deterministic at the cost of one extra token. The Generic `AGENTS.md` policy fragment (`src/core/skill/templates/content/connector-policy-fallback.md`) documents this form. Trailing `--key value` / `--key=value` pairs map to the operation's argument object; repeated keys become arrays.

#### Gap 37 — MCP tool-name normalization rule

**What's missing.** [Traveling Maesters](features/traveling-maesters.md) specifies `<connector_name>__<operation_name>` with "hyphens in either side converted to underscores for cross-host compatibility." The exact rule, allowed-character set, and validation point need to be pinned so MCP and the fallback CLI agree.

**Why it matters.** A single tool can be referenced from `maester connector list` output (humans), the MCP `tools/list` response (agents), and an installed Grand Maester policy paragraph (instructional examples). All three must produce the same string for the same `(connector, operation)` pair.

**Resolution.** The normalization is implemented in `src/core/connectors/tool-name.ts.toolName(connector, operation)`. Rule: lowercase both halves; replace every `-` with `_`; join with `__`; validate the result against `^[a-z][a-z0-9_]*$`. A violation is treated as a programmer error (a connector name or operation name that the schema would have rejected at config load, or a registry entry with a malformed operation name) and crashes the server with a clear stderr message before any MCP frames are exchanged. Both `src/core/mcp/server.ts` and `src/cli/commands/connector.ts list` consume the same function so the names match exactly.

#### Gap 38 — Operation `inputSchema` generation

**What's missing.** MCP's `tools/list` requires a JSON Schema `inputSchema` for each tool. The connector framework defines operation arguments via zod (`argsSchema`); converting them to JSON Schema by hand for every operation would be brittle.

**Why it matters.** A drift between the zod schema (used for runtime arg validation) and the JSON Schema (used by the agent to construct calls) would let the agent pass arguments the connector rejects, or vice versa.

**Resolution.** Add `zod-to-json-schema` as a direct runtime dependency. `src/core/connectors/input-schema.ts` is the only caller; it converts each operation's `argsSchema` once at server startup and caches the result. The bridge is configured to emit a minimal JSON Schema dialect — no `$defs`, no `$ref`, no `$schema` — so every MCP host parses it the same way. Re-using the zod schema for both validation and discovery guarantees they cannot drift.

#### Gap 39 — Per-host MCP config file paths and formats

**What's missing.** The framework PRD calls for writers that register the maester MCP server in each agent host's project-level MCP config but does not pin the file paths or content formats — those are owned by each host platform and are not uniform.

**Why it matters.** Wrong paths or wrong shapes mean the agent never sees the tools.

**Resolution.** One writer per host under `src/core/mcp/registrations/`:

| Host | File path | Format | Entry |
|---|---|---|---|
| Claude Code | `<repo-root>/.mcp.json` | JSON | `{ "mcpServers": { "maester": { "command": "npx", "args": ["-y", "baller-maester", "mcp"] } } }` |
| Cursor | `<repo-root>/.cursor/mcp.json` | JSON | Same shape as Claude Code (Cursor adopted Anthropic's convention) |
| Codex CLI | `<repo-root>/.codex/config.toml` | TOML | `[mcp_servers.maester]` block with `command = "npx"` and `args = ["-y", "baller-maester", "mcp"]`. Codex reads project-local config for trusted projects and merges with the user-global `~/.codex/config.toml`. No absolute paths are embedded, so the file is safe to commit. |

Each writer reads the existing file (when present) with a format-preserving parser, mutates only its managed key/block, and round-trips everything else byte-for-byte. JSON files use a key-order-preserving parser (the same one the Claude Code `settings.json` writer uses for the existing Grand Maester hook). TOML round-tripping requires `@iarna/toml` as a new direct runtime dependency — pinned at v2.x — chosen for its mature round-trip support and zero further deps. Writers are idempotent (running twice produces byte-identical output). The Generic `AGENTS.md` Grand Maester target is **not** an MCP host; its writer is not in this set.

**Implementation note.** The Codex CLI path and TOML shape above match Codex's currently-documented project-level MCP convention; implementing the Codex writer requires verifying the documented schema at implementation time and, if it has shifted, updating this writer (the other two writers are unaffected). The framework is otherwise host-agnostic.

#### Gap 40 — Connector entry schema in citadel.yaml

**What's missing.** The citadel schema needs to accept `connectors` while still validating per-type `config` blocks. Without a clear chokepoint the validation could happen in three places (schema, loader, dispatcher) and drift.

**Why it matters.** A misconfigured connector that passes the citadel schema but fails at first MCP tool call is a poor experience — the user sees the error long after they typed the config. Validation must happen at citadel-load time.

**Resolution.** `src/schemas/citadel.ts` extends `CitadelConfigSchema` with an optional `connectors` array. Each entry is parsed against a base `ConnectorBaseSchema` (`{ name, type, auth?, description?, config }`) where `config` is `z.unknown()`. The citadel's existing `.superRefine` is extended to:

1. Look up each `connectors[i].type` in `CONNECTOR_TYPE_REGISTRY` (imported from `src/core/connectors/registry.ts`). Unknown type → `addIssue` with the offending `path: ["connectors", i, "type"]`.
2. Parse `connectors[i].config` against the registered type's `configSchema` (which is `.strict()`). Failure → `addIssue` per zod error with rewritten `path` so the citadel-level error message points at `["connectors", i, "config", ...]`.
3. Assert each `connector.name` appears at most once in `connectors` (separate namespace from `sources` — see Gap 47).

This puts per-type validation in the registry where the type owns it, while citadel-load remains the single point that surfaces the error. The schema-to-registry import direction is `schemas/ → core/connectors/registry.ts`, which is a one-way reference and the only such direction in the codebase.

#### Gap 41 — MCP server stdout discipline

**What's missing.** The MCP wire protocol owns stdout (every line is a JSON-RPC frame). The project's existing `consola` logger writes status output to stdout by default. Without a discipline, a stray log line corrupts the JSON-RPC stream and breaks the host platform's parser.

**Why it matters.** This is the single most catastrophic class of bug an MCP server can introduce — and it's one a `console.log` snuck into a connector handler can cause.

**Resolution.** `src/core/mcp/transport.ts` is the only module that boots the SDK; it reconfigures the shared `consola` logger to write **only to stderr** before constructing the `Server`. The prompt layer (`@clack/prompts`) is disabled unconditionally when `maester mcp` runs — there is no TTY to prompt on by definition. The `--json` flag is treated as a no-op in `mcp` mode (the structured surface is MCP itself). A unit test asserts that no module under `src/core/connectors/` or `src/core/mcp/` imports the bare `console` global. The CLI command `src/cli/commands/mcp.ts` is the only command file allowed to invoke the transport binding; other commands cannot accidentally enter MCP mode.

#### Gap 42 — Init walkthrough connector-registration placement

**What's missing.** The Citadel Initialization walkthrough has an established order — source registration, then Grand Maester offer. The framework PRD adds a connector-registration step but does not pin where it goes.

**Why it matters.** The Grand Maester offer needs to know whether connectors are configured so it can write MCP server registrations in the same pass for any MCP-capable target the user installs. If the connector step comes after the Grand Maester offer, the user would have to re-run skill install to pick up new connectors.

**Resolution.** The connector-registration step sits **between** source registration and the Grand Maester offer. The init flow becomes: detect role → source loop → connector loop (this feature) → Grand Maester offer (which now writes MCP registrations when relevant). Declining the connector loop completes init normally with an empty `connectors` array, and the Grand Maester install proceeds without writing MCP server entries. The `src/cli/commands/init.ts` flow registers the new prompt block at this position; the connector prompts themselves live in `src/core/connectors/types/<id>/prompts.ts` so each type owns its prompt sequence.

#### Gap 43 — Grand Maester connector-policy paragraph

**What's missing.** The framework PRD specifies that Grand Maester adds a "short policy paragraph" about reasoning over connector tool output but does not pin the content or its delivery into per-target shells.

**Why it matters.** Without committed content, every implementation iteration could rewrite the paragraph and drift from the framework PRD's promise. Without a delivery mechanism, it competes for space in each per-target shell with the existing three behaviors.

**Resolution.** Two new content fragments under `src/core/skill/templates/content/`:

- `connector-policy.md` — composed into the managed regions of MCP-capable targets (Claude Code, Codex CLI, Cursor). Fixed wording per §6.11: live data, cite identifiers, point-in-time, watch freshness verdict, do not assume undocumented fields, names follow `<connector>__<operation>` convention.
- `connector-policy-fallback.md` — composed into the Generic `AGENTS.md` target. Documents the fallback CLI surface with sample invocations; explains that the agent must shell out via `maester connector exec <name> <op>` because no MCP client is available.

The skill installer enumerates **no connectors** in either artifact — MCP `tools/list` is the canonical surface. The Generic fallback paragraph references the configured tools by name only via examples drawn from `maester connector list` output; if no connectors are configured, the paragraph is suppressed.

#### Gap 44 — Connector error envelope and code set

**What's missing.** The framework PRD describes the envelope conceptually (success / failure, code set, message, details) but the architecture must pin the JSON keys, the bounded code set, and the chokepoint that builds it.

**Why it matters.** Both the MCP path and the fallback CLI path emit the same envelope. If they assembled it independently, drift would let one client parse one path's output but not the other.

**Resolution.** Single chokepoint at `src/core/connectors/envelope.ts`. Envelope shape (see §4):

```jsonc
{ "schema": 1, "connector": "...", "operation": "...", "ok": true,  "data":  { "dataSchema": <int>, ... } }
{ "schema": 1, "connector": "...", "operation": "...", "ok": false, "error": { "code": "...", "message": "...", "details": {...}? } }
```

`schema` is the envelope version (bumps only on breaking changes). `dataSchema` is per-type and independent.

Bounded `error.code` set, treated as a stable interface:

`missing-env-var` · `connector-not-found` · `unknown-operation` · `invalid-argument` · `auth-failed` · `remote-error` · `internal-error`

Per-type errors that do not fit the framework set map to `remote-error` with `details.kind` carrying the sub-classification (e.g., `not-found`, `rate-limited`, `transport`, `unexpected`). Adding new codes is additive and triggers a `schema` bump only if a code is removed or repurposed. `src/core/connectors/dispatch.ts` is the only place that returns the envelope; connector handlers throw `ConnectorError` instances that the dispatcher catches and translates. Uncaught exceptions become `internal-error` envelopes — the dispatcher logs them to stderr but the MCP server never crashes on a single tool failure.

#### Gap 45 — GitLab `project` value interpretation (path vs. numeric ID)

**What's missing.** GitLab's API accepts a project identifier as either a URL-encoded path or a numeric ID. The PRD allows both shapes but does not pin the interpretation rule.

**Why it matters.** A `project` value that is purely numeric could be a numeric ID or a path that happens to be all digits (rare but possible). Inconsistent interpretation would let a config validate but produce 404s at runtime.

**Resolution.** `src/core/connectors/types/gitlab-issues/client.ts` applies the rule: `^\d+$` → use verbatim as a numeric project ID; otherwise URL-encode and use as a path. The interpretation is logged at `--verbose` (stderr in MCP mode) so operators can see what GitLab will receive. Validation at config-load time (`schema.ts`) rejects empty / whitespace values but does not attempt to disambiguate path-vs-ID — the runtime rule is sufficient.

#### Gap 46 — Connector mutations refresh MCP registrations

**What's missing.** `maester connector add` and `maester connector remove` must keep the per-host MCP config files in sync with `citadel.yaml`, but the framework PRD does not commit to whether the refresh happens automatically or requires a follow-up `maester skill upgrade`.

**Why it matters.** If the refresh is manual, every connector mutation forces the user to remember a second command — and missing it means the host platform's tool surface goes stale.

**Resolution.** `add` and `remove` end by calling `src/core/mcp/registrations/index.ts.refreshMcpRegistrations(repoRoot)`, which iterates installed Grand Maester targets via `listSkillTargets()` and rewrites each MCP-capable host's managed entry from the updated citadel config. The refresh is idempotent — when no MCP-capable target is installed, the function reports "no MCP hosts to update" and returns without writing. The CLI's final stdout names the files written and reminds the user that their next agent session picks up the change (host platforms usually restart MCP servers automatically when their config file changes; the reminder makes it unambiguous regardless of host behavior).

#### Gap 47 — Connector name collisions with source names

**What's missing.** Sources and connectors live in separate config arrays but share the same slug shape. A connector named `team-docs` and a source named `team-docs` are valid under the schema but reading the config can confuse a future maintainer.

**Why it matters.** Hard rejection would force pointless renames in cases where the two namespaces are genuinely separate (e.g., a `gitlab` source repo and a `gitlab` issues connector that target related-but-different surfaces). Silent acceptance is worst — the maintainer never learns the collision is there.

**Resolution.** Allowed (separate namespaces) but the management commands (`maester init`, `maester connector add`) emit a warning when adding a connector name that already exists in `sources` (and vice versa for sources in future flows). The warning is informational; the entry is still added. The schema does **not** enforce cross-namespace uniqueness — this is a UX warning, not a data-model invariant.

#### Gap 48 — Connector tool description composition

**What's missing.** Each MCP tool's `description` is built from two sources: the per-type's `describeTool(operation, resolvedConfig)` template and the connector entry's optional `description`. The PRD says the entry's `description` is "prepended" but does not pin the chokepoint or the separator.

**Why it matters.** Different agents are sensitive to description format in different ways; a consistent composition rule keeps tool-selection reasoning predictable across hosts.

**Resolution.** Composition happens in a single chokepoint `src/core/connectors/dispatch.ts.buildToolDescription(connector, operation, resolvedConfig)`. Rule: if `connector.description` is set, the output is `${connector.description.trim()} ${typeDescription}` joined with a single space (the connector's description is expected to be a short sentence — the prompt and validation enforce a reasonable maximum length); otherwise the output is `typeDescription` alone. No connector type assembles its own composition. The result is what appears in `tools/list`, in `maester connector list` output, and in any installed Grand Maester sample.

### Assumptions

- **One repository, one role each.** A repo has at most one `citadel.yaml` and at most one `maester.yaml`. Both can coexist (as confirmed by [Maester Configuration P1](features/maester-configuration.md)); the schemas and tooling assume single-instance per role per repo.
- **No prior tool state to migrate.** This is a greenfield project. The loader supports forward-migration scaffolding but ships with v1 only.
- **Partial clone requires `git ≥ 2.27`.** The fetch strategy in §6.7 uses `--filter=blob:none` + sparse checkout. Older binaries fall back to a conventional `--depth=1` clone with a `--verbose` notice; final destination contents are identical.
- **`citadel/` is a safe default top-level directory.** No PRD prohibits the default. Users with a conflicting `citadel/` directory at their repo root will hit the destination-clobber guard (Gap 6) and be directed to either set the top-level `baseDir` to a different folder (Gap 15) or set per-source `destination` overrides.
- **`--json` output is one JSON object per line (NDJSON).** Implied by [stack.md §9](stack.md). Confirmed here so tests and downstream consumers can rely on it.
- **MCP-capable Grand Maester targets are Claude Code, Cursor, and Codex CLI.** The Generic `AGENTS.md` target is treated as instruction-only and receives the fallback CLI documentation, not an MCP registration. If a future Grand Maester target adds MCP support, the framework adds one writer file under `src/core/mcp/registrations/` and one entry in that directory's index — no other change.
- **Codex CLI MCP registration is project-local with no absolute paths.** Codex CLI v0.132 reads project-local `<repo>/.codex/config.toml` for trusted projects (`[projects."<repo>"] trust_level = "trusted"` in `~/.codex/config.toml`) and merges with the user-global file. The block contains only `command` and `args` (no `cwd` field), keeping the file portable and safe to commit — verified by testing that Codex resolves and launches the server correctly without it. This matches the symmetric pattern Claude Code (`<repo>/.mcp.json`) and Cursor (`<repo>/.cursor/mcp.json`) already use, and means deleting a citadel removes its Codex registration automatically. Older Codex versions reportedly had spotty support for project-local MCP servers (closed-without-fix [openai/codex#3441](https://github.com/openai/codex/issues/3441) at v0.31, open [#13056](https://github.com/openai/codex/issues/13056)); current versions work as documented.
- **All three MCP writers embed `npx -y baller-maester mcp` as the launch line.** This is the canonical MCP-ecosystem pattern: every host platform that consumes `.mcp.json` / `.cursor/mcp.json` / `.codex/config.toml` already knows how to spawn `npx -y <package>`. The npm package is `baller-maester`; `maester` is the bin name inside the package; `mcp` is the subcommand. Using the package name (not the bare bin) means `npx` resolves through the registry, which both (a) finds the user's globally-installed version when present and (b) auto-downloads on first use when not. The `-y` flag suppresses the install confirmation that would otherwise stall Codex's startup handshake. The registration is portable across machines (no absolute paths) and self-updates on the next `npm publish`. **Local-dev caveat**: during pre-publish development of maester itself (e.g. `pnpm link --global` from the source tree), the `npx -y baller-maester` form fails because the package isn't on the registry yet — manually swap to `command = "maester"`, `args = ["mcp"]` in the generated file for local testing until the version ships.
- **No live config reload while `maester mcp` is running.** The server reads `citadel.yaml` once at startup. Mid-session connector mutations require the host platform to restart the MCP server (which most do automatically when their MCP config file changes). Live reload is a deferred capability tracked in [traveling-maesters.md](features/traveling-maesters.md).

---

