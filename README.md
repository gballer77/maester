# Maester

> Aggregate documentation from many sources into one central knowledge home for developers and AI agents.

[![CI](https://github.com/baller-software/maester/actions/workflows/ci.yml/badge.svg)](https://github.com/baller-software/maester/actions/workflows/ci.yml)

Maester is a Node CLI and helper library for teams whose knowledge is spread across multiple sources — Git repositories today, with hosted document tools and web sources planned next. A **citadel** gathers content from many remote git repositories into a structured knowledge base that is easier to read, update, and reason over.

A repo you own can publish a `maester.yaml` manifest declaring what it offers — the citadel consumes whatever the manifest publishes. For sources you do not own (public third-party repos, vendor docs you have read access to), the citadel can take ownership of the filter set by declaring an `includes` list directly on the source — see below.

## Two roles, two files

Maester defines two repository roles, each declared by a single committed YAML file at the directory where the CLI was invoked:

| Role     | File           | Created by         |
|----------|----------------|--------------------|
| citadel  | `citadel.yaml` | `maester init`     |
| maester  | `maester.yaml` | `maester publish`  |

A directory can hold one role, the other, or both. There is at most one of each per directory.

### Where do the files land?

**Every maester command uses the current working directory as the root.** When you run `npx baller-maester init` from a directory, `citadel.yaml` is created in that exact directory — never in an ancestor. The same goes for `npx baller-maester publish` (writes `maester.yaml` here), `npx baller-maester sync` (reads `citadel.yaml` from here), and the interactive menu (`npx baller-maester`).

If you run a maester command from the wrong directory, `cd` to the intended directory and re-run. The CLI does not walk upward to find a project root, so a stray `.git/` or `package.json` in a parent directory will not pull configuration files away from where you typed the command.

## Quickstart

In the directory you want to populate with aggregated knowledge:

```sh
npx baller-maester              # interactive menu (uses cwd as root)
npx baller-maester init         # citadel walkthrough — creates ./citadel.yaml
npx baller-maester sync         # fetch all configured sources — reads ./citadel.yaml
```

In a directory that *publishes* docs to other citadels:

```sh
npx baller-maester publish      # maester manifest walkthrough — creates ./maester.yaml
```

## Editing your config

Once `citadel.yaml` or `maester.yaml` exists, change it with the same prompts that created it instead of hand-editing YAML:

| Citadel (`citadel.yaml`) | Maester (`maester.yaml`) |
|---|---|
| `maester add` — add a source | `maester publish add` — add a document |
| `maester remove` — pick a source to remove | `maester publish remove` — pick a document to remove |
| `maester list` — table of sources | `maester publish list` — table of documents |

- The same verbs appear in the `npx baller-maester` menu once a config exists.
- Writes are atomic and keep your comments, key order and every entry you didn't touch.
- `remove` won't delete the last entry: a citadel needs one source, and an empty `documents` list would publish the whole repository.
- Removing a source leaves its synced folder on disk; delete it yourself if you no longer need it.

## Pulling from sources you don't own

Every entry in `citadel.yaml` is a **source** — a remote git repo. Each source resolves to one of three modes, checked in this order:

1. **Includes-driven** (`includes` set): the citadel declares the filter set directly. The remote `maester.yaml` (if any) is ignored. Use this for public third-party repos and vendor docs you can read but not modify.
2. **Manifest-driven** (no `includes`, remote `maester.yaml` lists ≥1 document): the remote owns the publish surface; the citadel just consumes it. Use this for repos you own.
3. **Whole-repository** (no `includes`, and no `maester.yaml` or one with `documents: []`): every file in the repo is surfaced, minus excludes. A `maester.yaml` that fails validation is still an error — it never falls back to whole-repository.

```yaml
# citadel.yaml (excerpt)
schemaVersion: 1

sources:
  # Manifest-driven — the remote publishes its own maester.yaml.
  - name: design-system
    url: https://github.com/example-org/design-system.git

  # Includes-driven — the citadel owns the filter set.
  - name: react-docs
    url: https://github.com/facebook/react.git
    ref: main
    includes:
      - docs/**/*.md
      - README.md
    description: Upstream React documentation snapshot.
```

`npx baller-maester sync` processes every source in one pass. The trade-off for the includes-driven mode: when the remote repo restructures, the citadel's `includes` may need to be updated. Sync prints a warning when an includes-driven source resolves to zero files so drift is visible.

### Whole-repository sources are linked, not copied

Whole-repository content is never committed into the citadel. Sync fills the destination with one symbolic link per file, pointing into the local cache at `.maester/cache/<name>/`, and adds the destination (e.g. `/citadel/handbook/`) to `.gitignore` the first time. Sync output labels the source `(linked)` and says why it resolved to whole-repository. Because links point into the cache, deleting `.maester/` leaves them dangling — `maester status` reports this as `behind` / `cache-missing`, and the next `maester sync` restores them. To get a committable copy, declare `includes` or publish manifest entries instead.

These are always skipped (`maester sync --help` prints the list):

- VCS, dependency and build directories: `.git`, `.hg`, `.svn`, `node_modules`, `bower_components`, `vendor`, `.venv`, `venv`, `__pycache__`, `.tox`, `Pods`, `dist`, `build`, `out`, `target`, `coverage`, `.next`, `.nuxt`, `.turbo`, `.cache`, `.gradle`, `.maester`, plus `.DS_Store` files
- Binary files (a NUL byte in the first 8000 bytes) and files over 1 MiB

Narrow it further with `excludes` on the source:

```yaml
  - name: handbook
    url: https://github.com/example-org/handbook.git
    excludes:
      - archive/**
      - "**/*.draft.md"
```

`excludes` only applies in whole-repository mode; on an includes- or manifest-driven source sync warns that it was ignored.

## Local directories as sources

A source can point at a directory on this machine with `path:` instead of `url:`. There is no git, cache, or network involved. Use it for sibling checkouts, notes folders, or anything you are editing locally.

```yaml
sources:
  # Linked (default): symlinks to the live files, gitignored, machine-specific.
  - name: platform-docs
    path: ../platform-docs          # repo-relative, absolute, ~/…, or ${ENV_VAR}/…

  # Copied: a committable snapshot, refreshed on each sync.
  - name: handbook
    path: ${HANDBOOK_HOME}
    mode: copy
    includes:
      - "**/*.md"
```

- **Filter set:** chosen exactly as for git sources: `includes`, then the directory's `maester.yaml`, then the whole directory (always linked; `mode: copy` without declared paths fails that source).
- **Link mode:** one symlink per file. Targets are relative when `path` is repo-relative and absolute otherwise. Edits show through immediately; adding or removing files needs a `maester sync`. The destination is added to `.gitignore`.
- **Copy mode:** copies only the resolved files and applies inline state like a git source. It is safe to commit.
- **Guards:** a `path` may not sit inside, or contain, the citadel's base directory or any destination. `ref` and `auth` are rejected on path sources. A missing directory or unset `${VAR}` fails only that source.
- **Status:** never touches the network. It reports `local-changed` when the files differ from the last sync and `failed` / `source-missing` when the directory or a linked original is gone.
- **Agents that will not follow symlinks** can use the MCP tools `citadel__list_linked_documents` and `citadel__read_linked_document`. They are registered whenever the citadel has a linked destination. `citadel` is therefore a reserved connector name.

`maester init` asks "Git repository or local directory?" for each source.

## Classifying documents: state, category and tags

Copied files are stamped with up to three inline fields when they are synced into the citadel, so any reader can classify a file just by opening it:

| Field | Values | Default |
|---|---|---|
| `state` | `draft` or `canon` | `draft` |
| `category` | one kebab-case slug, e.g. `spec` | unset (not written) |
| `tags` | a list of kebab-case slugs, e.g. `[api, public]` | unset (not written) |

Declare them on a `maester.yaml` document entry, or on an enriched citadel `includes` entry:

```yaml
includes:
  - path: docs/**
    state: canon
    category: reference
    tags: [external, react]
  - README.md
```

- **Precedence is per field:** a value already inline in the file wins, then the first matching rule that sets that field, then the default. Inline `tags` replace the rule's list entirely.
- **Where the values go:** frontmatter (Markdown), `<!-- category: spec -->` comments before the DOCTYPE (HTML), top-level keys (YAML/JSON), or leading `category: spec` lines (`.txt`). Other formats are left untouched.
- **Linked sources are never rewritten.** They carry only what is already in the original files.
- **Output:** sync prints `categories: spec 12 · adr 4 · unclassified 3 · tags: 7 distinct` per source. `--verbose` shows each file's values and where each came from. `--json` adds `categoryBreakdown` and `tagRollup`.
- **Mismatches:** an inline value that differs from its rule gets a warning, which `--quiet` silences.

## Third-party MCP servers

Declare the MCP servers your team uses once in `citadel.yaml`, and every agent host that has the Grand Maester installed (Claude Code, Cursor, Codex) gets the same tools:

```yaml
mcpServers:
  - name: code-host                 # tools appear as code_host__<tool>
    kind: local
    command: npx
    args: ["-y", "@example/code-host-mcp"]
    envVars: [CODE_HOST_TOKEN]      # names only; export the values in your shell

  - name: tracker
    kind: remote
    url: https://mcp.tracker.example.com/mcp
    auth: { envVar: TRACKER_TOKEN } # sent as Authorization: Bearer <value>
    tools: [search_tickets]         # optional allowlist

  - name: wiki
    kind: remote
    url: https://mcp.wiki.example.com/mcp
    register: direct                # written into each host's own config instead
```

- **Proxied (default):** `maester mcp` starts or connects to the server and exposes its tools under the single `maester` registration. A server that fails to start only loses its own tools.
- **Direct (`register: direct`):** a separate, maester-managed entry is written into each host's MCP config. Use it for remote servers that need the host's own sign-in flow.
- **Secrets:** only env-var names appear in any file maester writes. Local servers receive only the names you list, plus `PATH`/`HOME`-style basics.
- **Manage them:** `maester mcp-server add`, `remove`, `list`, and `check`. `check` starts each proxied server and reports its tools, or why it failed. `maester init` also offers this step.
- **Names** share one namespace with connectors; `maester` and `citadel` are reserved.

## Prerequisites

- **Node.js** ≥ 24 LTS
- **git** ≥ 2.27 (older versions fall back automatically to `--depth=1` clones)
- **pnpm** 9.x for development (consumers can use any package manager)

## Local Development Setup

```sh
git clone https://github.com/<org>/maester.git
cd maester
pnpm install
pnpm run build
pnpm run test
```

## Available Scripts

| Script | Purpose |
|---|---|
| `pnpm run build` | Bundle CLI + library with `tsup` |
| `pnpm run dev` | Watch mode build |
| `pnpm run test` | Run Vitest unit + e2e tests once |
| `pnpm run test:watch` | Watch mode tests |
| `pnpm run lint` | Lint with Biome |
| `pnpm run lint:fix` | Lint and auto-fix |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run format` | Format with Biome |
| `pnpm run prepublishOnly` | Full quality gate (lint + typecheck + test + build) |

## Try the CLI Locally

```sh
pnpm link --global
cd /tmp/my-scratch-repo
git init
maester
```

## Environment Variables

Maester reads tokens only at runtime; nothing secret is ever written to disk. Per-source token env-var **names** are stored in `citadel.yaml`; the values live in your shell, `.env` loader, or CI secret manager.

| Variable | Purpose |
|---|---|
| `<user-defined>` | Each source with `auth.type: "token"` reads from the env-var name in its config (e.g. `MAESTER_DOCS_TOKEN`). |
| `NO_COLOR` | Disable ANSI color. Standard. |
| `FORCE_COLOR` | Force color (`0`–`3`). Standard. |
| `MAESTER_THEME` | `light` or `dark` to override automatic detection. |
| `MAESTER_NO_MOTION` | Replace spinners with static elapsed counters. |
| `MAESTER_NO_WELCOME` | Suppress the first-run welcome banner. |

## Project Structure

```
src/
├── cli/        Commander dispatch + interactive walkthroughs
├── core/       Domain (config, git, sync, auth)
├── schemas/    Zod schemas for the two YAML configs
└── ui/         Theme + logger + terminal components
test/           Vitest unit + e2e tests
gspec/          Living specifications
```

## Specifications

This project is built from a living specification under `gspec/`. The product profile, technology stack, visual style guide, development practices, technical architecture, and per-feature PRDs all live there. Changes to behavior should update the relevant spec; see `CLAUDE.md` for the contract.

## License

MIT.
