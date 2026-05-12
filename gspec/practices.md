---
description: Standard TDD, pipeline first, well named features, try, etc.
name: uber-practices
spec-version: v1
---

# Development Practices Guide

## 1. Overview

This guide covers the following practices:

- **Testing** — Unit tests for all non-trivial logic using real file I/O (not mocks), focused E2E tests for critical user-facing workflows, exhaustive asset/link integrity checks in CI, and behavior-oriented test naming
- **Code quality** — DRY after 3+ uses, max 3 levels of nesting, functions under 40 lines, early returns over deep conditionals
- **Code organization** — Group by function, isolate environment-specific logic, separate content from implementation logic, consistent naming conventions per language
- **Version control** — Trunk-based on `main`, one logical change per commit, imperative commit messages, semver tags for releases
- **CI/CD pipeline** — A functioning build-test-deploy pipeline is built and included in the initial implementation, not deferred to a later milestone
- **Documentation** — Comment the "why" not the "what", require README and DEPLOYMENT.md for every project, changelog per release
- **Error handling** — Fail fast with clear messages (what failed, what was expected, what to do), non-zero exit codes, no silent failures, verbose mode for debugging
- **Performance** — Minimize dependencies, optimize for clarity over speed, keep startup and common operations fast
- **Security** — Validate all user input, no secrets in the repo, minimal pinned dependencies, guard against injection and path traversal
- **Refactoring** — Refactor before adding features (in a separate commit), require passing tests before refactoring, track intentional debt with contextual TODOs

---

## 2. Core Development Practices

### Testing Standards

#### Unit Tests
- **Coverage expectation:** Solid coverage of all non-trivial logic — parsing, data transformation, argument handling, configuration resolution, and environment-specific paths
- **What to test:**
  - Functions that transform data (e.g., parsing structured input, generating file paths, resolving configuration)
  - Edge cases in argument parsing and validation
  - File system operations — use temp directories, not mocks, for file I/O tests
  - Version comparison and migration logic
- **What not to test:**
  - Simple pass-through functions or trivial wrappers
  - Static content or prose (these aren't logic)
  - Third-party library behavior

#### E2E Tests
- **When to use:** For critical user-facing workflows where a unit test can't catch integration failures:
  - Setup and installation flows across supported environments
  - Configuration file creation and removal
  - Cross-module trigger and sync behavior
- **Keep E2E tests minimal and focused** — each test should cover one complete workflow, not a matrix of variations

#### Asset & Link Integrity
- **Every project that serves assets (images, stylesheets, scripts, fonts, downloadable files, etc.) must include an automated check that verifies every referenced asset actually loads.** A broken asset reference is a shipping defect, not a cosmetic issue — it must be caught before deploy, not by a user.
- **What to verify:**
  - Every referenced asset (images, stylesheets, scripts, media sources, fonts, favicons, manifest entries, in-project route links, and downloadable files) resolves with a success response
  - Styling-embedded asset references (e.g., background images and fonts referenced from stylesheets) resolve
  - No client-error or server-error responses anywhere in the asset graph of any page that the project serves
  - Any base-path or subpath prefixing required by the deploy target resolves correctly (stack files specify the mechanism)
- **How to implement:** Use a link/asset checker appropriate to the stack against the built output, run in CI after the build stage and before the deploy stage; a failure blocks the deploy. Stack files name the specific checker to use
- **Coverage expectation:** Every page the project serves is crawled. Do not sample — assets regress silently, so the check must be exhaustive
- **External references:** In-project assets must pass. External URLs may be checked with a warning rather than a hard failure, since external flakiness shouldn't block deploys

#### Test Organization
- Test files live alongside source files or in a `tests/` directory mirroring the source structure
- Name test files `<module>.test.<ext>` matching the source file
- Each test file tests one module or one workflow
- Test names describe the behavior, not the implementation: `"saves config to the user data directory"` not `"calls writeFile with correct args"`

#### When to Write Tests
- Write tests when adding new logic or fixing bugs — the bug fix test proves the fix works and prevents regression
- Skip tests for exploratory or prototype code, but add them before considering the feature stable
- If a change touches setup paths or environment detection, add or update an E2E test

### Code Quality Standards

- **DRY:** Extract shared logic only when it's used in 3+ places. Two similar blocks are fine — premature abstraction is worse than repetition in a small codebase
- **Nesting:** Maximum 3 levels of nesting. Use early returns and guard clauses to flatten logic
- **Function length:** Keep functions under 40 lines. If a function does multiple distinct things, split it
- **Complexity:** If a function has more than 4 conditional branches, refactor into smaller functions or use a dispatch pattern

### Code Organization

- **File structure:** Group by function — each distinct domain lives in its own module
  - If the project has a website or docs site, keep it in its own directory with its own dependency manifest, separate from the main package
- **Naming conventions:**
  - Files: `kebab-case` with the appropriate extension
  - Variables: `snake_case` or `camelCase` consistently per language convention
  - Constants: `UPPER_SNAKE_CASE`
- **Separation of concerns:**
  - Entry points handle argument parsing and dispatching only
  - Environment-specific logic is isolated in dedicated modules — no environment `if/else` chains in core logic
  - Content and configuration are separate from the logic that manages them

---

## 3. Version Control & Collaboration

### Git Practices

- **Branch strategy:** Trunk-based — work directly on `main` for routine changes. Use short-lived branches (`experiment/<name>`) only for risky experiments that might be abandoned
- **Commit messages:** Imperative mood, concise first line (≤ 72 chars). Body when the "why" isn't obvious from the diff
  ```
  Add cache invalidation for config changes

  The cache was only checking auth tokens. Config file changes
  now trigger a cache refresh as well.
  ```
- **Commit size:** One logical change per commit. Don't mix refactoring with feature work in a single commit
- **Tags:** Use semver tags (`v1.6.0`) for releases

### CI/CD Pipeline

- **Pipeline first:** A functioning CI/CD pipeline is part of the initial implementation, not a later milestone. The first deployable commit must flow through the same pipeline that will carry every subsequent change
- **Minimum pipeline scope:** The pipeline must install dependencies, run the full test suite, build the project, and deploy to the target environment. If any of these stages don't yet apply to the project, include the stage with a no-op or placeholder so the shape is in place
- **Automatic triggers:** The pipeline runs on every push to `main` and on every pull request. Deployments trigger automatically on merges to `main` (or on tag pushes for tagged-release projects)
- **Status visibility:** Pipeline status is surfaced in the repo (status checks on PRs, badge in README) so a broken pipeline is impossible to miss
- **No manual deploy steps:** Once the pipeline is in place, production deploys go through the pipeline. Manual deploys are an escape hatch for incidents, not a normal workflow

---

## 4. Documentation Requirements

- **Comments in code:**
  - Comment the "why," not the "what" — if the code needs a "what" comment, the code should be clearer
  - Always comment non-obvious idioms, environment-specific workarounds, or compatibility hacks
  - No boilerplate comment headers on files or functions
- **README:** Every project must include a `README.md` at the repo root with at minimum:
  1. **Project description** — A clear, concise explanation of what the project is, who it's for, and why it exists (2–4 sentences)
  2. **Prerequisites** — Required tools, runtimes, package managers, and pinned versions for the stack
  3. **Local development setup** — Step-by-step instructions to clone, install dependencies, and run the project locally. Use the stack's idiomatic commands
  4. **Available scripts** — A table or list of key commands (build, test, run, lint, etc., named per the stack's conventions) with a one-line description of each
  5. **Environment variables** — List any required or optional env vars with descriptions and example values (never include actual secrets)
  6. **Project structure** — A brief overview of the top-level directory layout if the structure isn't obvious from the file names alone
  - Keep it focused and scannable — the README is for getting a developer productive quickly, not for exhaustive documentation
- **DEPLOYMENT.md:** Every project that is deployed must include a `DEPLOYMENT.md` at the repo root with step-by-step production deployment instructions:
  1. **Hosting environment** — Where the project is deployed and any account/access requirements (stack files specify the platform)
  2. **Pre-deployment checklist** — Steps to verify before deploying:
     - All tests pass
     - Build succeeds locally
     - Environment variables are configured in the hosting platform
     - Version bumped if applicable
  3. **Deployment steps** — The exact commands or process to deploy, whether manual or CI/CD:
     - For manual deploys: the specific commands to run in order
     - For CI/CD: describe the pipeline trigger (e.g., push to `main`, tag push) and what the pipeline does
  4. **Post-deployment verification** — How to confirm the deployment succeeded:
     - URLs to check
     - Smoke tests to run
     - Logs or dashboards to monitor
  5. **Rollback procedure** — How to revert to the previous version if something goes wrong
  6. **Domain & DNS** — If applicable, document the domain configuration and where DNS is managed
     - **Never invent or guess a domain name.** Only reference a domain if it is explicitly defined in `profile.md`. If no domain is defined, document the hosting platform's default URL (stack files specify its form) and note that a custom domain is not configured. Do not write placeholder domains like `example.com` or fabricate a domain from the project name.
  - Keep instructions concrete and copy-pasteable — a developer who has never deployed the project should be able to follow this document and succeed on the first attempt
- **Changelog:** Update for each release with user-facing changes grouped by Added/Changed/Fixed/Removed

---

## 5. Error Handling & Logging

- **Fail fast:** If a required directory, file, or tool isn't found, exit immediately with a clear error message. Don't attempt partial operations
- **Error messages:** Include what went wrong, what was expected, and what the user can do about it
  ```
  Error: Config directory not found at ~/.config/myapp/
  Expected: ~/.config/myapp/ to exist. Run the initial setup before proceeding.
  ```
- **Exit codes:** Use non-zero exit codes for all error paths. Use distinct codes for different failure categories if helpful for scripting
- **Logging levels:**
  - Default: Only output that the user needs to see (progress, success/failure)
  - Verbose (`--verbose` or `-v`): Include file paths being written, environment detection results, and skip reasons
  - No debug logging in released code — use verbose mode instead
- **Never swallow errors silently** — if an operation fails, report it. Don't continue as if it succeeded

---

## 6. Performance & Optimization

- **Startup speed:** Keep common operations fast. Minimize dependencies to keep setup and execution snappy
- **No premature optimization:** Optimize for clarity and correctness, not speed — unless the code is in a hot path
- **Dependency weight:** Every dependency adds setup time and supply chain risk. Prefer built-in language APIs and standard utilities over adding packages for trivial operations
- **Frontend performance:** If the project has a user-facing frontend, establish the stack's standard performance benchmarks as a baseline and don't regress them (stack files specify the tooling and thresholds)

---

## 7. Security Practices

- **Input validation:** Validate all user-provided paths and arguments before using them in file operations or commands. Never interpolate raw user input into commands without sanitization
- **No secrets in the repo:** Keep secrets, API keys, and credentials out of the repository. If secrets are needed, use environment variables and document them
- **File permissions:** Don't change file permissions unless necessary. Configuration and content files should be readable, not executable
- **Supply chain:** Keep dependencies minimal. Pin exact versions in lock files. Review dependency updates before merging
- **Common vulnerabilities to avoid:**
  - Command injection via unsanitized input interpolation
  - Path traversal — validate that generated file paths stay within expected directories
  - Symlink attacks — don't follow symlinks when writing to config directories

---

## 8. Refactoring Guidelines

- **When to refactor:** When you're about to add a feature and the existing code makes it awkward. Refactor first in a separate commit, then add the feature
- **When to rewrite:** Only when the current approach is fundamentally wrong (e.g., an architecture that can't support a new requirement without being rethought). This should be rare at MVP stage
- **Safe refactoring:** Always have passing tests before refactoring. If there are no tests for the code you're about to refactor, add them first
- **Technical debt:** If developing technical debt is required, ask the user first. If approved, track debt with `TODO:` comments (using the stack's comment syntax) that explain *why* the shortcut was taken and *when* it should be revisited — e.g., "TODO: processes items one-by-one; batch when we have more than a dozen items." A bare `TODO` with no context is not acceptable
- **Boy Scout Rule:** Apply lightly — clean up what you touch, but don't refactor unrelated code in the same commit

---

## 9. Definition of Done

A change is done when:

- [ ] The code works correctly for the intended use case
- [ ] CI/CD pipeline is in place and green (on the initial implementation) or still green (on subsequent changes)
- [ ] Unit tests cover new or changed logic
- [ ] E2E test added or updated if the change affects setup flows or environment integration
- [ ] Asset/link integrity check passes — no error responses for any referenced asset or in-project link in the built output
- [ ] Error paths produce clear, actionable messages
- [ ] `--verbose` output is helpful for debugging
- [ ] No regressions in existing tests
- [ ] Commit message explains the "why"
- [ ] Version bumped if this is a release
- [ ] Changelog updated if this is a user-facing change
