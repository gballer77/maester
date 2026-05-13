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

**Every maester command uses the current working directory as the root.** When you run `npx maester init` from a directory, `citadel.yaml` is created in that exact directory — never in an ancestor. The same goes for `npx maester publish` (writes `maester.yaml` here), `npx maester sync` (reads `citadel.yaml` from here), and the interactive menu (`npx maester`).

If you run a maester command from the wrong directory, `cd` to the intended directory and re-run. The CLI does not walk upward to find a project root, so a stray `.git/` or `package.json` in a parent directory will not pull configuration files away from where you typed the command.

## Quickstart

In the directory you want to populate with aggregated knowledge:

```sh
npx maester              # interactive menu (uses cwd as root)
npx maester init         # citadel walkthrough — creates ./citadel.yaml
npx maester sync         # fetch all configured sources — reads ./citadel.yaml
```

In a directory that *publishes* docs to other citadels:

```sh
npx maester publish      # maester manifest walkthrough — creates ./maester.yaml
```

## Pulling from sources you don't own

Every entry in `citadel.yaml` is a **source** — a remote git repo. Each source is one of two modes, decided implicitly by whether you declare an `includes` list on it:

- **Manifest-driven** (no `includes`): the remote repo publishes its own `maester.yaml` declaring what it offers. The remote owns the publish surface; the citadel just consumes it. Use this for repos you own.
- **Includes-driven** (`includes` set): the citadel declares the filter set directly. The remote `maester.yaml` (if any) is ignored. Use this for public third-party repos, vendor docs you have read access to but cannot modify, and any other source that does not publish a manifest.

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

`npx maester sync` processes every source in one pass. The trade-off for the includes-driven mode: when the remote repo restructures, the citadel's `includes` may need to be updated. Sync prints a warning when an includes-driven source resolves to zero files so drift is visible.

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
