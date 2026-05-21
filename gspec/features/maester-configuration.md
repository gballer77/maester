---
spec-version: v1
implementation-order: 3
---

# Maester Configuration

## 1. Overview

**Feature name:** Maester Configuration

**Summary:** An interactive flow (reached from the `npx baller-maester` top-level menu) that turns the current repository into a "maester" — a git repository that publishes a curated set of documents to any citadel that requests them. The flow produces a maester configuration file at the repository root that declares which paths the repo publishes and what they represent. No scripts are scaffolded; the maester is purely a published manifest.

**Problem being solved:** A repository that holds knowledge worth sharing (a service README, a set of runbooks, architecture notes, conventions) has no standard way to declare which files it is willing to publish to consumers. Without that declaration, every citadel either pulls the entire tree or has to negotiate paths out-of-band. Maester Configuration gives every repository a single, committable file that names exactly what it offers — so citadels can pull a precise, intentional subset and so the publishing team owns the contract.

**Canonical use case:** A system of systems made of multiple microservice repos. Each microservice repo is configured as a maester whose published documents are scoped to its `README.md`. A separate knowledge-base repo is the citadel that consumes all those READMEs into one place, where humans or AI tools can reason over them together.

## 2. Users & Use Cases

**Primary users:**
- Service owners / repository owners who want their repo's documentation to be discoverable and pullable by other projects
- Documentation maintainers curating a "publish surface" for their repository
- Engineers in a system-of-systems environment where each repo contributes a piece of a larger knowledge picture

**Key use cases:**
1. **First-time configuration of a microservice repo.** A developer in a service repo runs `npx baller-maester`, picks "Configure this repo as a maester" from the top-level menu, declares `README.md` as the published document, and ends with a committed maester config.
2. **Multi-document publication.** A larger repo declares several published documents (README, ADR directory, runbooks) in one walkthrough, each with an optional category/description so a consuming citadel can tell them apart.
3. **Both roles in one repo (rare).** A repo that is itself a citadel for upstream sources also publishes a curated subset downstream; both configs coexist at the repo root because they are independent files.
4. **Re-running safely.** The user re-enters the maester configuration flow in a repo that is already configured. The flow detects the existing manifest and offers safe options without destructive overwrites.

## 3. Scope

**In-scope:**
- A "Configure this repo as a maester" entry in the `npx baller-maester` top-level menu
- Interactive walkthrough that collects one or more published-document entries
- Each entry: a path (file or glob, relative to the repo root), an optional `state` choice (`draft`, `canon`, or "file header" to defer to inline state in each file), plus optional metadata (description, category, tags)
- Writing the maester configuration file at the repository root
- Detecting an existing maester configuration and refusing to overwrite silently
- Basic validation of paths (well-formed, repo-relative, no path-escape)
- Final summary plus next-step guidance, rendered through the shared CLI styling layer

**Out-of-scope:**
- Scaffolding or installing any sync, build, or runtime script — Maester Configuration is **manifest-only**
- Network operations of any kind during configuration
- Defining how a consuming citadel discovers, fetches, or applies this manifest (owned by [Maester Sync](maester-sync.md))
- Editing or removing individual published-document entries after the file is written (deferred)
- Validating that path globs resolve to actual files (P1 capability is best-effort, not authoritative)
- A non-interactive / flag-driven mode

**Deferred ideas:**
- Editing verbs (`maester publish add`, `maester publish remove`, `maester publish list`) for incrementally modifying an existing maester config
- A non-interactive flag mode for CI bootstrapping
- Maester-side categories that map to standardized roles (e.g. `readme`, `runbook`, `adr`) with built-in suggestions
- A "publish lint" that warns when declared paths no longer resolve in the working tree
- Versioning the maester manifest so consumers can pin to a published contract revision

## 4. Capabilities

- [x] **P0**: User can reach the "Configure this repo as a maester" flow from the `npx baller-maester` top-level menu
  - The top-level menu offers maester configuration as a clearly labeled option
  - Selecting it from a repo with no existing maester config opens the configuration walkthrough
  - The flow is reachable without any prior global install (still invokable via `npx`)

- [x] **P0**: User can declare one or more published documents during the walkthrough
  - For each entry the walkthrough collects a path (file or glob, repo-relative)
  - The user can add another entry or finish at any step
  - At least one entry is required to complete configuration; an empty manifest is rejected
  - The walkthrough's prompts and confirmations render through the shared CLI styling layer

- [x] **P0**: User can attach optional metadata to each published entry
  - Optional fields per entry: description (short free-text), category (short identifier), tags (zero or more short identifiers)
  - Any combination of optional fields may be omitted on a given entry
  - The walkthrough makes clear which fields are optional vs required

- [x] **P0**: Configuration writes a maester manifest file at the repository root
  - The file is created at a single, predictable repo-root path
  - The file is human-readable and safe to commit
  - The file contains a schema/version marker so future tooling can migrate it
  - The schema is consumable by [Maester Sync](maester-sync.md) without further translation

- [x] **P0**: Configuration installs no scripts and writes no executable artifacts
  - The flow produces exactly one new file (the maester manifest); no script files, package.json edits, or hook installations occur
  - Any future "publish lint" or related capability is out of scope here

- [x] **P0**: Paths are validated for shape before being accepted
  - Paths must be repo-relative; leading slashes and `..` segments are rejected with a clear message
  - Empty paths and whitespace-only paths are rejected
  - Path-shape validation is local only; no file-system existence check is required at this priority

- [x] **P1**: Re-running the maester configuration flow in a configured repo is safe
  - Existing manifest is detected and never silently overwritten
  - User is shown a summary of the current manifest (entry count, paths) and offered safe options (view config path, exit)
  - The walkthrough never deletes or truncates the existing manifest without explicit confirmation

- [x] **P1**: Walkthrough warns when a declared path does not resolve in the working tree
  - For non-glob entries, the walkthrough checks whether the file exists at config time and surfaces a soft warning when it does not
  - For glob entries, the walkthrough optionally previews how many files currently match
  - Warnings never block the user from saving — a maester may legitimately publish a future path

- [x] **P1**: Maester configuration coexists with citadel configuration in the same repo
  - The maester manifest file and the citadel configuration file have distinct, non-overlapping names
  - Either file can exist independently; both files can exist together without conflict
  - Configuring one role never touches or modifies the other role's file

- [x] **P1**: User receives clear next-step guidance at the end of configuration
  - Final stdout (styled via the shared CLI layer) reports: where the manifest was written, how many entries it contains, and a reminder that consuming citadels will pick up the manifest at their next sync
  - Exit code is zero on success and non-zero on user cancellation or error

- [x] **P2**: Walkthrough offers lightweight suggestions for common publish patterns
  - When the repo root contains a `README.md`, the walkthrough offers it as a one-click default entry
  - Suggestions are additive; the user can always decline and enter paths manually
  - No suggestion is ever added without explicit user confirmation

## 5. Dependencies

- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Shares the `npx baller-maester` top-level menu entrypoint. The two flows are siblings under that menu; neither depends on the other's runtime behavior.
- **Maester Sync** ([maester-sync.md](maester-sync.md)) — Consumes the manifest produced by this feature. Maester Sync's P1 capability ("honor path filters published by each maester's own configuration") is the consumption contract for this manifest.
- **Pretty CLI** ([pretty-cli.md](pretty-cli.md)) — All walkthrough prompts, summaries, and status messages render through the shared CLI styling layer.

**External dependencies:**
- A package registry / distribution channel that makes `npx baller-maester` executable without a prior global install

## 6. Assumptions & Risks

**Assumptions:**
- A repository has at most one maester configuration at a time, located at the repository root
- The maester manifest is a trusted, repo-committed artifact; it does not need to be defended against tampering during configuration
- The set of "documents" a maester publishes is a list of files or globs — there is no need for richer content addressing (URLs, virtual files, generated content) in v1
- Path filtering for what a consuming citadel pulls is fully owned by the maester via this manifest; the citadel does not separately re-filter

**Risks:**
- **Over-publication via greedy globs.** A user writes `**/*` and accidentally exposes more than intended. *Mitigation:* the walkthrough shows a match preview for glob entries (P1) and the manifest is committed (peer review catches mistakes).
- **Drift between manifest and working tree.** Files referenced in the manifest are later renamed or deleted, but the manifest is not updated. *Mitigation:* the optional path-resolution warning at config time surfaces immediate issues; ongoing drift is left to a future "publish lint" capability and the consuming citadel's sync output, which will report missing paths.
- **Naming collisions with the citadel config.** A user is confused about which file is which. *Mitigation:* the two files have distinct, intuitive names and the walkthrough's success output names the file written.
- **Schema lock-in.** v1 schema choices constrain future extension. *Mitigation:* the manifest contains a schema/version marker from day one so migrations are possible without breaking older manifests.

## 7. Success Metrics

- A user can go from "service repo with a README" to "a committed maester manifest publishing that README" in one command and under thirty seconds of interaction
- 100% of generated manifests are consumable by [Maester Sync](maester-sync.md) without manual edits
- Zero script files, package.json modifications, or hook installations occur as a side effect of configuration
- Re-running the maester configuration flow in a configured repo never destroys or silently mutates the existing manifest

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
