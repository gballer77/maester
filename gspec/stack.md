---
spec-version: v1
---

# Technology Stack

## 1. Overview

### Architecture Style
Single-package Node.js library that also exposes a CLI binary. There is no long-running server, no client–server split, and no orchestrated services. The package runs locally on a developer machine or a CI runner: it reads YAML configuration, performs filesystem and Git operations against the surrounding repository (and, in time, calls hosted-document and web APIs), and writes files into a target directory.

### Deployment Target
Distribution is via the npm registry. End users invoke the tool with `npx <package>` or install it as a dev dependency. The package runs anywhere Node.js runs — local dev machines, GitHub Actions runners, container images. There is no hosted infrastructure to operate.

### Scale & Performance Requirements
Workload is bounded by the number of configured sources and the size of the documents they declare — practically tens to low hundreds of files per run. Operations should complete in seconds, not minutes. Concurrency is single-process; parallelism within a run (e.g., fetching multiple sources at once) is acceptable but not load-critical.

## 3. Core Technology Stack

### Programming Languages

**Primary:** TypeScript (strict mode, `target: ES2023`, `module: NodeNext`).

Rationale: TypeScript is the de facto standard for new Node.js libraries in 2026. Strict typing helps consumers of the library API and catches config-shape mistakes early. The CLI itself benefits from typed Commander option definitions.

**Secondary:** None.

**Language tooling:**

- Type checker: `tsc --noEmit` (separate from the build step).
- Linter + formatter: **Biome** v2.x — single tool, faster than ESLint + Prettier, native config in `biome.json`.

### Runtime Environment

**Runtime:** Node.js 24 LTS as the minimum supported version. CI runs against current LTS and the upcoming Node release.

**Module system:** ESM-only. `package.json` declares `"type": "module"`. The CLI bin uses an ESM entrypoint; the library exports ESM with TypeScript `.d.ts` declarations.

**Container runtime:** Not applicable. The package runs as a Node process; containerization is an integrator concern.

## 4. Frontend Stack

Not applicable — this is a CLI / library project with no graphical or web frontend.

## 5. Backend Stack

Not applicable — there is no backend service. The package runs locally and integrates with external services (Git remotes, hosted document APIs, web URLs) as a client.

## 6. Infrastructure & DevOps

### Cloud Provider
Not applicable. The package itself is not hosted. Future integrations call third-party APIs (GitHub, Google Drive, Microsoft Graph) but do not require the project to operate cloud infrastructure.

### Container Orchestration
Not applicable.

### CI/CD Pipeline

**Platform:** GitHub Actions.

Rationale: The repository is hosted on GitHub. GitHub Actions is the lowest-friction CI for a GitHub-hosted OSS project, ships with a generous free tier for public repositories, and integrates natively with the npm registry (via OIDC trusted publishing) and the GitHub release UI.

**Configuration shape:**

- Workflow files live in `.github/workflows/` as YAML.
- A `ci.yml` workflow runs on pull requests and pushes to main: lint, type-check, test, build.
- A `release.yml` workflow runs on version tags: build, publish to npm via OIDC (no long-lived `NPM_TOKEN`), create a GitHub release with generated notes.
- Matrix testing across active Node LTS versions where the OS surface matters (filesystem, child_process behavior).

Pipeline structure (stages, gates, ordering, branch protection) is defined in `gspec/practices.md`. This document defines only the platform and its configuration shape.

### Infrastructure as Code
Not applicable — no infrastructure to provision. The only "infrastructure" artifact is the GitHub Actions workflow YAML, version-controlled with the source.

## 7. Data & Storage

### File Storage
**Local filesystem only.** The package reads source files from local clones or mounted paths and writes aggregated documents into the central repository's working tree. No object storage, CDN, or hosted assets are involved.

### Data Warehouse / Analytics
Not applicable.

## 8. Authentication & Security

### Authentication

For Git source operations, the package supports two complementary auth paths and **never persists secret values to disk**:

1. **Delegated (default).** When a maester's configuration declares no auth (`auth.type: "none"`), authentication is delegated to the user's local git configuration (SSH keys, credential helpers, GitHub CLI auth, etc.) via `simple-git`. The package does not interact with the user's credentials in this path.
2. **Env-var token (opt-in).** When a maester's configuration declares `auth.type: "token"` and names an environment variable (e.g. `MAESTER_DOCS_TOKEN`), the sync command reads that variable at execution time and passes the token to the Git operation — either by injecting it into the HTTPS URL as `https://x-access-token:${TOKEN}@host/…` or by configuring an equivalent `simple-git` HTTPS-auth option. The env-var **name** is committed to the citadel config; the env-var **value** is never written to disk, never logged, and never embedded in any string the package emits (URLs in error output must be redacted).

In both cases, the package stores the env-var name at most — not the secret. Credential lifetime, rotation, and storage remain the user's responsibility, supplied through their shell, `.env` loader, OS keychain, or CI secret manager.

**Planned for future source types:**

- Google Drive: OAuth 2.0 via the official `googleapis` package, with refresh tokens stored in the user's OS keychain (`keytar` or `@napi-rs/keyring`).
- OneDrive: OAuth 2.0 via the Microsoft Graph SDK with the same keychain-backed token storage.
- Web URLs: anonymous fetch by default; future support for bearer tokens or basic auth supplied through environment variables (never plain config files).

### Authorization
The package operates with the invoking user's filesystem and remote-source permissions. There is no in-process authorization layer.

### Security Tools

- **Secrets handling:** never read secrets from config files. Use environment variables or the user's credential store. Document this in the README.
- **Dependency scanning:** GitHub Dependabot for automated dependency updates; `npm audit` runs in CI.
- **Provenance:** publish to npm with `--provenance` via GitHub Actions OIDC, giving consumers a signed link from the published package back to the source commit and workflow.
- **Postinstall scripts:** none, and none allowed in transitive dependencies that the project introduces directly. They are a supply-chain hazard and break installs in `--ignore-scripts` environments.

## 9. Monitoring & Observability

### Application Monitoring
Not applicable — the CLI runs as a short-lived process invoked by the user. No APM.

### Logging & Terminal Output

There are two distinct output layers, kept separate by design:

1. **Interactive prompt layer (`@clack/prompts`).** Used inside TTY-only flows like `init` for selection menus, confirms, and inline spinners. Owns its own rendering loop and is suppressed automatically when stdout is not a TTY.
2. **Leveled logger (`consola`).** Used for everything else — status lines, progress narration, errors. Logs go to stdout/stderr; integrators may redirect.

Both layers route color through `chalk` so the palette in `gspec/style.md` §2 is the single source of truth.

- `--verbose` raises the logger level.
- `--quiet` suppresses everything but errors.
- `--json` emits machine-readable output for CI and agent consumption. In `--json` mode the prompt layer is bypassed entirely and the logger emits one JSON object per line — no color, no glyphs, no spinners.

### Tracing
Not applicable.

### Error Tracking
Not applicable. Errors surface to the user's terminal and CI logs. The CLI uses non-zero exit codes for failure paths.

## 10. Testing Infrastructure

> The stack is the single authority for test tooling choices. Testing philosophy, patterns, and coverage requirements are defined in `gspec/practices.md`.

### Testing Frameworks

- **Unit + integration tests:** **Vitest** v2.x — fast, ESM-native, TypeScript-aware, near-zero config.
- **CLI end-to-end tests:** Vitest tests that spawn the built CLI binary against fixture directories. No separate framework needed.
- **Component testing:** not applicable.

Rationale: Vitest covers unit, integration, and CLI-level tests in a single framework. Node's built-in `node:test` is a viable alternative but lacks Vitest's mocking ergonomics and watch experience.

### Test Data Management

- **Fixtures:** static fixture repositories and sample documents under `test/fixtures/`. Tests copy fixtures into temp directories per case.
- **Temp dirs:** `node:fs/promises.mkdtemp` with `os.tmpdir()` and a deterministic prefix; cleaned up after each test.
- **Mocking:** prefer real filesystem and real `git` invocations against fixtures. Mock only network calls (future hosted-source integrations) using `msw/node` or an `undici` mock pool.

### Performance Testing
Not applicable at current scale. If aggregation runs grow into the multi-minute range, introduce timing assertions in integration tests before reaching for dedicated tooling.

## 11. Third-Party Integrations

### External Services

- **Git remotes:** GitHub (HTTPS or SSH) and any other host the user's `git` binary can reach. No vendor lock-in.
- **npm registry:** publication target.
- **Planned:** Google Drive API, Microsoft Graph (OneDrive), arbitrary HTTP(S) endpoints for web sources.

### Key Library Dependencies

| Concern | Library | Notes |
|---|---|---|
| CLI framework | `commander` | Verb-based commands (`init`, `check`, `pull`, …). |
| Interactive prompts | `@clack/prompts` | Charm-inspired select, multiselect, confirm, text, password, and spinner. ESM-native, TypeScript-first, promise-based. Matches the visual treatment in `gspec/style.md` §6 (cursor `▸`, braille spinner, two-space indent). |
| Terminal color | `chalk` v5 | Truecolor support via `chalk.hex()`; auto-downgrades to 256 / 16 / no-color. Carries the palette tokens defined in `gspec/style.md` §2. |
| Color depth detection | `supports-color` | Detects truecolor / 256 / 16 / none. Drives the palette-resolution algorithm. |
| Leveled logging | `consola` | Status output for non-interactive paths and `--verbose` / `--quiet` / `--json` modes. Distinct from the interactive prompt layer above. |
| ASCII banners | `figlet` | First-run welcome and `--help` / `--version` banner using the "Small Slant" font per the style guide. Lazy-loaded so routine commands don't pay the cost. |
| Boxed regions | `boxen` | Completion summaries and the heavy-bordered error box. |
| Tables | `cli-table3` | Source-status tables in `check` / list output. |
| Progress bars | `cli-progress` | Determinate progress for multi-source `pull` operations. |
| Hyperlinks | `terminal-link` | OSC-8 hyperlinks in `--help` text (clickable in iTerm2, WezTerm, Kitty, VS Code terminal). |
| Unicode fallback | `is-unicode-supported` | Decides between Unicode glyphs (`▸ ✓ ✗ ◯ ◉`) and ASCII fallbacks (`> [ok] [X] [ ] [x]`). |
| Config parsing | `yaml` (eemeli/yaml) | YAML 1.2, preserves comments on re-write. |
| Config validation | `zod` | Runtime schema validation; types inferred for TS consumers. |
| Git operations | `simple-git` | Typed wrapper over the user's installed `git` binary. |
| HTTP client (planned) | `undici` / native `fetch` | Native to Node 24; high-performance. |
| Globbing | `globby` | Source-document selectors in configs. |
| Pattern matching | `picomatch` | Pure-pattern matching of a path string against a glob (no FS lookup). Used by the state-tag resolver to find which `includes` / `documents` entry produced a given materialized file. Already present transitively via `globby` / `fast-glob`; declaring it directly avoids depending on transitive resolution. |
| Markdown frontmatter | `gray-matter` | Parse / round-trip YAML frontmatter on markdown documents. Used by the state-tag reader/writer for `.md` files. |
| Path handling | `node:path`, `pathe` | Cross-platform normalization. |
| OS keychain (planned) | `keytar` or `@napi-rs/keyring` | Future OAuth token storage. |

### API Clients
Future hosted-tool integrations should prefer the official vendor SDKs (`googleapis`, `@microsoft/microsoft-graph-client`) over hand-rolled HTTP to minimize auth surface area. Web-URL fetches use the native `fetch` global; reach for `undici` directly only when a custom dispatcher or mock pool is needed.

### API Versioning Strategy
The package itself follows Semantic Versioning. Breaking changes to the CLI command surface or the YAML config schema bump the major version. Schema changes ship with a documented migration path.

## 12. Development Tools

### Package Management

- **Package manager:** **pnpm** v9.x for developing this repository. Rationale: fast installs, strict node_modules layout that catches missing peer dependencies, native workspace support if the project later splits into sub-packages.
- **End-user installation:** users consume the package via `npx`, `npm install`, or whatever package manager they already use. The published package is package-manager-agnostic.
- **Lockfile:** `pnpm-lock.yaml` is committed.
- **Private registry:** not applicable; published publicly to npm.

### Code Quality Tools

- **Linter + formatter:** Biome.
- **Type checking:** `tsc --noEmit` as a CI step.
- **Pre-commit hooks:** `simple-git-hooks` (lightweight, no dependency tree). Hooks run Biome on staged files and execute typecheck on commit.

### Local Development

- **Build tool:** **tsup** v8.x. Fast ESM build with bundled CLI bin and emitted `.d.ts` files. Watch mode for library development.
- **Watch mode:** `tsup --watch` for incremental rebuilds; `vitest --watch` for tests.
- **Local install:** `pnpm link --global` to test the CLI against real repositories during development.

## 13. Migration & Compatibility

### Legacy System Integration
Not applicable — greenfield project.

### Upgrade Path

- **SemVer discipline:** major bumps signal breaking changes to either the CLI surface or the config schema.
- **Deprecation warnings:** mark planned breaking changes with runtime warnings one minor version before the major bump.
- **Config schema versions:** each config file declares its schema version; the loader migrates older versions forward where the transformation is mechanical and refuses to load schemas it does not understand.

## 14. Technology Decisions & Tradeoffs

### Key Architectural Decisions

**Commander over Oclif.** The CLI command surface is small and shaped around explicit verbs rather than discoverable plugin commands. Commander matches that shape without imposing a plugin runtime. If a plugin ecosystem emerges, the CLI layer can be reorganized without changing the underlying library.

**YAML over JSON or JS for config.** Config files are hand-edited by repository maintainers, often committed to repos owned by people who never run the CLI. YAML's comment support and lower visual noise win for human edits, at the cost of indentation sensitivity. `zod` validation closes the gap on type safety.

**`simple-git` over `isomorphic-git`.** Every realistic user of this tool already has `git` installed. Delegating to the system `git` binary inherits the user's auth setup (SSH keys, credential helpers, `gh auth`) and gets full feature coverage for free. `isomorphic-git`'s strength is sandboxed and browser environments, which this project does not target.

**ESM-only.** New Node libraries in 2026 should be ESM-first. Dual-output complicates the build, the published surface, and bug reports. Consumers stuck on CJS can use dynamic `import()`.

**Biome over ESLint + Prettier.** Single binary, single config, faster runs. The ESLint plugin ecosystem is larger, but Biome covers the rules a TypeScript Node library needs.

**`@clack/prompts` over Inquirer for interactive prompts.** Clack ships with the visual treatment described in `gspec/style.md` (sleek minimal layout, braille spinner, light cursor glyph) out of the box. Inquirer is more featureful and battle-tested but its default styling diverges from the Charm-influenced aesthetic the style guide commits to, and overriding it would mean re-implementing most of what Clack already does. Clack is also ESM-native and ~10× smaller. The featureset (select, multiselect, confirm, text, password, spinner, intro/outro grouping) covers every interactive surface the CLI needs.

**`chalk` over `picocolors`.** Picocolors is tiny but does not expose truecolor hex APIs. The style guide commits to a truecolor palette with documented fallbacks to 256 and 16-color terminals — `chalk` v5 implements that downgrade ladder automatically via `supports-color`. The size delta is negligible for a CLI that already depends on `commander`, `yaml`, `zod`, and `simple-git`.

**pnpm over npm/yarn for development.** Strict resolution catches phantom dependencies — important for an OSS package whose own dependency graph must be lean and correct.

### Alternatives Considered

- **Oclif** for the CLI — rejected because the plugin model is heavier than needed at this stage.
- **`@inquirer/prompts`** for interactive prompts — viable and arguably more mature; rejected because Clack matches the style guide's visual language with less customization.
- **`prompts` (terkelg)** — lightweight and elegant; close to Clack in spirit but no longer actively developed. Clack picks up where it left off.
- **`gum`** (Charm's Go binary, shelled out) — the gold-standard Charm experience but requires users to install a separate Go binary, which kills the `npx baller-maester` story.
- **`ora`** for spinners alongside Inquirer — viable if we move off Clack; until then, Clack's built-in spinner is preferred for consistency.
- **`picocolors`** for color — viable for ANSI-named colors but lacks truecolor APIs the style guide depends on.
- **`node:test`** for testing — viable; Vitest chosen for mocking, watch, and config experience.
- **Plain `tsc`** for build — viable; `tsup` chosen for build speed and clean CLI-bin output. Revisit if build time becomes a non-issue.
- **`changesets`** for release management — deferred; for a single-package repo, manual version bumps with tagged releases are sufficient until contributor cadence justifies it.

### Risk Mitigation

| Risk | Mitigation |
|---|---|
| `git` not present on the user's machine | Detect at startup; fail with a clear message naming the missing binary. |
| Future Google/Microsoft SDKs balloon install size | Make hosted-source integrations optional peer dependencies, loaded lazily. |
| YAML config schema drift | `zod` validation with versioned schema; emit actionable errors pointing at the offending field. |
| Supply-chain risk on a Node package | Pinned lockfile, Dependabot, `npm publish --provenance`, no postinstall scripts. |
| Breaking CLI changes hurt automated users | SemVer discipline; deprecation warnings one minor version before the major bump. |

## 15. Technology-Specific Practices

### Framework Conventions & Patterns

**Commander:**

- Define one command per source file under `src/commands/`. Each module exports a `register(program: Command): void` function that the entrypoint calls.
- Use `.action(async (opts, command) => …)` — return promises from action handlers; Commander awaits them.
- Declare option types with TypeScript: `program.opts<{ verbose: boolean }>()`.
- Top-level errors bubble to `main()`, which sets the process exit code. Do not call `process.exit()` from action handlers.

**Configuration loading:**

- A single config-loader module wraps `yaml.parse()` then `zod.parse()`. The loader returns a typed config or throws a structured error with `cause` pointing at the offending YAML line/column.
- Never consume partially-validated config. Downstream code uses the post-`zod` type, not the raw parsed YAML.

### Library Usage Patterns

**`simple-git`:**

- Wrap `simple-git` calls in a thin internal module so the rest of the codebase imports a typed `git.clone(...)` / `git.fetch(...)` facade. This isolates the dependency and keeps tests mockable.
- Pass repository paths and refs as discrete arguments — never interpolate them into a command string.

**`zod`:**

- One schema file per config kind under `src/schemas/`.
- Use `z.infer<typeof Schema>` for runtime-derived types. Do not maintain parallel TypeScript interfaces.
- Prefer `.strict()` schemas on user-facing configs to surface typos as errors instead of silently dropping unknown fields.

**HTTP (when added):**

- Use the global `fetch` exposed by Node 24+. Reach for `undici` directly only when you need a custom dispatcher or a mock pool (tests).

### Language Idioms

**TypeScript:**

- `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. These three are non-negotiable for a library API.
- Use `unknown` rather than `any` at module boundaries. Narrow with `zod` or type predicates.
- Export only the types and functions intended as public API from `src/index.ts`. Internal modules are not re-exported.
- Avoid `enum`; use `as const` object literals or string-literal unions.

**ESM:**

- Always use explicit file extensions in relative imports (`./loader.js`, not `./loader`). TypeScript with `module: NodeNext` enforces this.
- The CLI binary starts with `#!/usr/bin/env node` and is referenced from `package.json`'s `bin` field.

### Stack-Specific Anti-Patterns

- **Synchronous `fs` calls in hot paths** — use `node:fs/promises` everywhere except module-load-time config reads.
- **`child_process.exec` with interpolated arguments** — always use `execFile` or `spawn` with separate argv arrays. `simple-git` already does this internally; preserve the pattern when shelling out elsewhere.
- **`console.log` for machine output** — anything emitted under `--json` must go through the JSON writer, not `console`. Stray logs corrupt the output stream.
- **Mutating the parsed config object after load** — treat config as immutable. Derived state lives in a separate object.
- **Postinstall scripts** — never ship one.
- **Top-level `await` in library entrypoints** — fine in CLI bins, but library consumers expect synchronous module loading. Keep async work inside exported functions.
