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
