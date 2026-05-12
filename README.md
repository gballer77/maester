# Maester

> Aggregate documentation from many sources into one central knowledge home for developers and AI agents.

Maester is a Node CLI and helper library for teams whose knowledge is spread across multiple sources — Git repositories today, with hosted document tools and web sources planned next. Each source (a **maester**) declares its relevant docs, and a **citadel** gathers them into a structured knowledge base that is easier to read, update, and reason over.

## Prerequisites

- **Node.js** ≥ 24 LTS
- **pnpm** 9.x or later (development)
- **git** ≥ 2.27 (for partial-clone optimizations; older versions fall back automatically)

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

## License

MIT.
