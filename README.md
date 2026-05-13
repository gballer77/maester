# Maester

> Aggregate documentation from many sources into one central knowledge home for developers and AI agents.

[![CI](https://github.com/baller-software/maester/actions/workflows/ci.yml/badge.svg)](https://github.com/baller-software/maester/actions/workflows/ci.yml)

Maester is a Node CLI and helper library for teams whose knowledge is spread across multiple sources — Git repositories today, with hosted document tools and web sources planned next. Each source (a **maester**) declares its relevant docs, and a **citadel** gathers them into a structured knowledge base that is easier to read, update, and reason over.

For sources you do not own (public third-party repos, vendor docs you have read access to), the citadel can also register **ravens** — see below.

## Two roles, two files

Maester defines two repository roles, each declared by a single committed YAML file at the repo root:

| Role     | File           | Created by         |
|----------|----------------|--------------------|
| citadel  | `citadel.yaml` | `maester init`     |
| maester  | `maester.yaml` | `maester publish`  |

A repo can be one role, the other, or both. There is at most one of each per repo.

## Quickstart

In the repository you want to populate with aggregated knowledge:

```sh
npx maester              # interactive menu
npx maester init         # citadel walkthrough
npx maester sync         # fetch all configured sources
```

In a repository that *publishes* docs to other citadels:

```sh
npx maester publish      # maester manifest walkthrough
```

## Ravens — pulling from sources you don't own

A citadel can declare **ravens** alongside its maesters. A raven is a git source the citadel pulls without any `maester.yaml` on the remote side — useful for public third-party repos and vendor docs you have read access to but cannot modify. Because the source publishes no manifest, the citadel itself declares an `includes` list (paths or globs) saying what to materialize.

```yaml
# citadel.yaml (excerpt)
schemaVersion: 2

maesters:
  - name: design-system
    url: https://github.com/example-org/design-system.git

ravens:
  - name: react-docs
    url: https://github.com/facebook/react.git
    ref: main
    includes:
      - docs/**/*.md
      - README.md
    description: Upstream React documentation snapshot.
```

`npx maester sync` syncs both kinds in one pass and labels each line with `[maester]` or `[raven]`. The trade-off versus a maester: when the source repo restructures, the citadel's `includes` may need to be updated. Sync prints a warning when a raven's includes resolve to zero files so drift is visible.

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

Maester reads tokens only at runtime; nothing secret is ever written to disk. Per-maester token env-var **names** are stored in `citadel.yaml`; the values live in your shell, `.env` loader, or CI secret manager.

| Variable | Purpose |
|---|---|
| `<user-defined>` | Each maester with `auth.type: "token"` reads from the env-var name in its config (e.g. `MAESTER_DOCS_TOKEN`). |
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
