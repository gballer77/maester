---
spec-version: v1
---

# Citadel Ravens

## 1. Overview

**Feature name:** Citadel Ravens

**Summary:** Adds a second class of pull source to the citadel — **ravens** — alongside maesters. A raven is a unilaterally-defined git source the citadel pulls from without requiring any cooperation on the remote side (no maester manifest, no out-of-band agreement). The citadel owner names the source, declares which paths to pull, optionally references an auth env-var, and sync surfaces the selected content into `citadel/<raven-name>/` just like a maester.

**Problem being solved:** Today, every pull source in a citadel must be a maester — a repository whose owner has agreed to publish a contract via [Maester Configuration](maester-configuration.md). That two-party model is right for trusted, owned-by-us repos, but it shuts the door on the long tail of useful knowledge: public third-party repos, vendor docs in public git, and (eventually) websites and cloud drives. A user who needs that content today must either fork the source to add a maester config (intrusive, often impossible) or copy files by hand (fragile, undocumented). Ravens give the citadel a sanctioned, version-controlled way to pull from any source it can read — at the cost of the citadel owner taking on the upkeep when the source's shape changes.

## 2. Users & Use Cases

**Primary users:**
- Repository owners who want their citadel to surface third-party reference material that they do not control
- Engineers maintaining a knowledge base that aggregates from a mix of owned and unowned sources
- AI-assisted developers who want public reference docs (style guides, API specs, vendor READMEs) available on disk for coding agents

**Key use cases:**
1. **Pulling a third-party public reference.** A user wants a popular open-source project's `docs/` directory available in their citadel. The project's owners do not run maester and never will. The user adds it as a raven with `includes: ["docs/**"]` and runs sync.
2. **Pulling from a private repo they have read access to.** A user has read access to a vendor's private repo but does not own it. They add it as a raven with `auth.type: "token"` pointing at a `VENDOR_DOCS_TOKEN` env-var name — the same pattern used for private maesters.
3. **Mixing maesters and ravens in one citadel.** A team's citadel pulls from three internal repos (maesters, owned and contract-bound) and two external public repos (ravens, no contract). One sync command handles both; the output labels each entry by kind.
4. **Tightening what a raven surfaces.** A raven was originally configured with `includes: ["**/*.md"]`. After the source repo restructures its layout, the user updates the includes to a narrower path. No code outside the citadel config changes.

## 3. Scope

**In-scope:**
- A `ravens` section in the citadel configuration file alongside the existing `maesters` section
- Per-raven fields: a short unique name, a git URL, a ref, a **required** list of include paths/globs, an optional destination override, and auth that mirrors the maester auth model (none or token-by-env-var-name)
- Shared name namespace with maesters — a raven name cannot collide with a maester name in the same citadel
- An optional raven-registration step in the citadel initialization walkthrough so users can declare ravens during first setup
- Sync support for ravens via the same single sync command that processes maesters
- Sync output that labels each entry as `maester` or `raven` so users can see at a glance which entries they own the contract for
- Idempotent sync semantics identical to maesters (added / updated / unchanged / failed) for ravens
- Auth resolution identical to maesters: env-var-name references resolved at runtime, no secret values on disk, missing env vars fail only that raven
- Destination semantics identical to maesters: default `citadel/<raven-name>/`, optional repo-relative override, no collisions with any other entry

**Out-of-scope:**
- Website / HTTP sources, cloud-drive sources, or any non-git fetch mechanism (deferred)
- A separate sync command for ravens — there is one sync command that processes both kinds
- Bidirectional sync against a raven (ravens are strictly read-only, like maesters)
- Editing the citadel config after the fact — adding/removing/editing ravens via CLI verbs follows the same deferred trajectory as adding/removing maesters
- Validating that a raven's source URL is reachable or that includes resolve before sync time
- Discovery, recommendation, or registry of "popular ravens"
- Honoring any publish manifest on the raven source — the citadel's includes are authoritative

**Deferred ideas:**
- HTTP / website ravens that fetch a URL into a single local file (next likely raven kind)
- Cloud-drive ravens (Google Drive, Dropbox, etc.) with appropriate auth
- A `maester ravens` verb family (`add`, `remove`, `list`) mirroring the deferred maester verbs
- A "raven lint" capability that flags includes which have matched zero files for N successive syncs
- Pinning a raven to a commit SHA for reproducible builds (likely paired with the deferred citadel-wide lockfile idea)
- Importing a shareable set of raven definitions from a manifest

## 4. Capabilities

- [ ] **P0**: Citadel configuration supports a `ravens` section alongside `maesters`
  - The schema version is bumped so consumers can distinguish citadels with and without raven support
  - A citadel with zero ravens (only maesters) is fully valid and behaves identically to before
  - A citadel with zero maesters and one or more ravens is also fully valid
  - Older citadel configs (no ravens key) are accepted unchanged

- [ ] **P0**: Each raven entry declares the fields needed for sync
  - Required per raven: a short unique name, a git URL, a ref (with the same "default branch when unspecified" rule as maesters), and a non-empty list of include paths/globs
  - Optional per raven: a destination override (repo-relative path), an auth block, a short description
  - An entry missing any required field or with an empty includes list is rejected with a clear error pointing at the offending field

- [ ] **P0**: Raven names share the same namespace as maester names within a citadel
  - The configuration is rejected if any raven name matches any maester name in the same citadel
  - The collision error names both colliding entries so the user can rename one
  - Within ravens, duplicate names are likewise rejected

- [ ] **P0**: Ravens authenticate using environment-variable references, identical to maesters
  - Per-raven auth defaults to `none`
  - When `auth.type` is `token`, the entry stores only the env-var name (e.g. `VENDOR_DOCS_TOKEN`), never a secret value
  - A missing required env var at sync time fails only that raven; other entries (maesters or ravens) continue
  - No secret value appears in sync stdout, stderr, or any written file

- [ ] **P0**: Sync processes ravens with the same single command that processes maesters
  - Running sync with no arguments fetches every configured maester and every configured raven
  - Each raven is fetched at its configured ref using the same git mechanics as maesters
  - The destination is populated with **only** the files matching the raven's includes; anything outside the includes never appears in the destination
  - Repeated runs are idempotent in the same sense as maesters (no spurious modifications when the source ref has not advanced)

- [ ] **P0**: Sync output labels each entry as `maester` or `raven`
  - The per-entry status line is unambiguous about which kind it is (e.g. `[raven] vendor-docs    updated`)
  - The final summary groups or otherwise distinguishes outcomes by kind so the user can see, for example, "3 maesters unchanged, 1 raven updated"
  - The exit-code rule from maester sync still applies: non-zero if and only if at least one entry (of either kind) failed

- [ ] **P0**: Ravens land in `citadel/<raven-name>/` by default with override support
  - Default destination is `citadel/<raven-name>/` at the repository root, identical to maesters
  - A per-raven destination override is honored exactly, with the same repo-relative + no-`..` rules as maesters
  - The configuration is rejected if any raven's destination collides with any other entry's destination (maester or raven) in the same citadel

- [ ] **P0**: The citadel initialization walkthrough can register ravens
  - During the walkthrough the user is offered the option to register one or more ravens after (or instead of) maesters
  - For each raven, the walkthrough collects: name, git URL, ref, includes (at least one), optional destination override, optional auth env-var name, optional description
  - The walkthrough enforces all configuration-level rules above (uniqueness across maesters + ravens, non-empty includes, destination collision detection) before saving
  - A user who declines to register any raven finishes init unchanged from the existing maester-only flow

- [ ] **P1**: Sync warns when a raven's includes match zero files at the resolved ref
  - The raven is reported with a clear "no files matched includes" warning in the output
  - The warning does not by itself fail the raven or the sync — the destination is left in a known-empty state and the run continues
  - The warning text references the raven name and the includes list so the user can act on it

- [ ] **P1**: User can scope a sync run to specific raven names
  - The same scoping mechanism that selects maesters by name (delivered by [Maester Sync](maester-sync.md)) also selects ravens by name
  - Unknown names produce a clear error and non-zero exit before any work begins, regardless of whether the name would have been a raven or a maester
  - All sync semantics above apply identically to the scoped subset

- [ ] **P1**: Ravens carry optional human-readable metadata
  - Each raven entry may include a short description and a list of short tags
  - Metadata is surfaced in sync output where helpful (e.g. alongside the raven name in verbose mode) and is otherwise informational
  - Metadata fields are optional everywhere — entries without them remain valid

- [ ] **P2**: Sync emits a provenance marker for each raven, mirroring maesters
  - The raven's destination contains a small metadata record naming the source URL, ref, resolved commit SHA, and the includes list active for that run
  - The marker is regenerated on every successful sync of that raven and is human-readable
  - The marker makes it possible to tell at a glance which version of which source produced the current files

## 5. Dependencies

- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Owns the citadel configuration file and the walkthrough that writes it. This feature extends the configuration schema and adds an optional raven-registration step to that walkthrough.
- **Maester Sync** ([maester-sync.md](maester-sync.md)) — Owns the sync runtime. This feature extends sync to process ravens alongside maesters, reusing the same auth resolution, idempotency, status reporting, and scoping mechanics.
- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — Unaffected, but called out as the contrasting model: maesters require a publish-side manifest, ravens do not.
- **Pretty CLI** ([pretty-cli.md](pretty-cli.md)) — Walkthrough prompts and sync output continue to render through the shared CLI styling layer; raven-specific labels and warnings use the same primitives.

**External dependencies:**
- The `git` binary on the host running sync (same requirement as maesters)
- Network access to the configured raven source hosts at sync time

## 6. Assumptions & Risks

**Assumptions:**
- A raven source is a standard git repository accessible by URL + ref + optional token — the only thing distinguishing it from a maester is the absence of a maester manifest on the remote side
- The citadel owner is responsible for choosing safe, well-scoped includes — there is no manifest-side guard rail
- The citadel owner accepts higher upkeep cost for ravens: when the source restructures, the citadel's includes may need to be updated
- License and attribution obligations for third-party content surfaced by a raven are the citadel owner's responsibility; this feature does not enforce them
- Raven destinations are owned by sync just like maester destinations — any local edits inside them are overwritten on the next sync
- Names continue to be unique within a citadel across both kinds, so a single `--only <name>` selection is unambiguous

**Risks:**
- **Greedy includes silently surface huge unowned trees.** A user writes `["**"]` and the destination explodes in size. *Mitigation:* the includes list is required (the user must think about it explicitly) and the walkthrough's existing copy can warn against overly broad globs. A future "raven lint" can flag this.
- **Source-side restructuring breaks the includes list without breaking the sync.** A raven keeps running but stops surfacing the intended files. *Mitigation:* the P1 "zero files matched" warning catches the most common case; the P2 provenance marker makes it easy to spot when a known-good ref has produced unexpectedly empty content.
- **Confusion between maesters and ravens.** Users may not understand which kind they're configuring. *Mitigation:* explicit labels in sync output (`[maester]` vs `[raven]`), separate walkthrough sections, and clear documentation in next-step guidance after init.
- **Destination collisions across kinds.** Sharing the same namespace means a raven and a maester can claim the same `citadel/<name>/` directory if validation is naive. *Mitigation:* configuration-level collision detection across the combined set of maesters and ravens, enforced both at write time (walkthrough) and read time (sync validation).
- **Token leakage in raven URLs.** A naive sync implementation could inline a token into a logged URL. *Mitigation:* the same redaction rule that already applies to maester sync extends to ravens — the sync logging path treats both kinds identically and never inlines secrets.
- **Schema migration friction.** Adding a `ravens` key changes the citadel schema. *Mitigation:* the schema is versioned from day one (existing requirement); older citadel files without the key are read as "zero ravens".

## 7. Success Metrics

- A user can add a public third-party repo as a raven during citadel init and, on first sync, have only the declared includes surfaced under `citadel/<raven-name>/` — without modifying anything in the remote source
- A citadel with N maesters and M ravens runs through a single sync command and produces one combined status summary that distinguishes the two kinds
- 100% of raven auth secrets remain absent from sync stdout, stderr, and any written file — verified by the same redaction checks used for maesters
- Zero raven entries with empty or missing includes are ever written to a citadel configuration

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
