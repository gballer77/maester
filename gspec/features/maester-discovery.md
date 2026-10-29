---
spec-version: v1
---

# Maester Discovery

## 1. Overview

**Feature name:** Maester Discovery

**Summary:** A one-shot `maester discover` command that scans one or more local directory roots for directories that declare a maester manifest, presents the candidates for review, and registers the chosen ones as sources in the citadel configuration. Discovery writes configuration only; it never changes citadel content on its own, and sync remains the step that surfaces the registered sources.

**Problem being solved:** A developer with many maester-bearing directories on disk — sibling checkouts, a workspace of related projects, a notes tree — has to register each one by hand, typing names and paths that the filesystem already knows. That friction means citadels stay incomplete and local knowledge goes unused. Discovery removes the typing while keeping the citadel declarative: the committed configuration stays the single truth about what the citadel contains, and a human confirms every addition. This deliberately avoids resolving sources dynamically at sync time, which would make citadel contents differ from machine to machine.

## 2. Users & Use Cases

**Primary users:**
- Developers bootstrapping a citadel in a workspace that already contains several maester-bearing repositories
- Citadel maintainers who periodically check whether new maesters have appeared near the citadel
- Scripted or CI workflows that need a machine-readable list of candidate maesters without modifying anything

**Key use cases:**
1. **Bootstrap from a workspace.** A developer runs discover from a fresh citadel. It scans the parent directory, finds four sibling checkouts with manifests, and the developer accepts all four. The config now has four path sources; a sync surfaces them.
2. **Periodic check for newcomers.** Weeks later the developer runs discover again. Three of the four are already registered and are skipped; one new directory is offered and added.
3. **Portable registration from a checkout.** One candidate is a git checkout with a remote origin. The developer chooses to register it by its git URL instead of its local path so teammates who clone the citadel get the same source.
4. **Non-interactive listing.** A script runs discover in JSON mode to list candidates under a specific root. Nothing is written; the script decides what to do with the result.

## 3. Scope

**In-scope:**
- A `discover` verb reachable both as a CLI subcommand and from the top-level menu when the current repository has a citadel
- Zero or more root directories as arguments; when none are given, the parent directory of the citadel repository is scanned
- A maximum scan depth with a sensible default and a flag to override it
- Candidate matching: a directory whose root contains a manifest file that passes the maester manifest schema
- Pruning: version-control metadata directories, dependency directories, the citadel's base directory and every configured destination, and any directory already registered as a path source (and its subtree)
- Deduplication against existing sources by resolved path and, for git checkouts, by remote origin URL
- An interactive review that lets the user accept or reject each candidate and adjust its name, description, and registration form (`path` or `url`)
- Writing accepted candidates into the citadel configuration through the same writer used by the existing add-source flow
- A non-interactive mode that accepts defaults, and a JSON mode that lists candidates without writing
- A next-step hint naming the sync command after at least one source is written

**Out-of-scope:**
- Resolving sources dynamically at sync time from a configured set of roots
- Registering remote sources that are not present on the local disk
- Running sync as part of discovery
- Discovering connectors (traveling maesters) or any non-manifest content
- Filesystem watching or scheduled re-discovery

**Deferred ideas:**
- A `discovery` block in the citadel configuration (roots and depth) that discover uses as its default scan set
- A hint in status output when unregistered maesters exist under the default root
- Offering includes-driven registration for directories that have documentation but no manifest

## 4. Capabilities

- [ ] **P0**: User can scan local directory roots for maester-bearing directories
  - With no arguments, the parent directory of the citadel repository is scanned to the default depth
  - One or more root arguments replace the default; each may be repo-relative or absolute, with `~` and `${ENV_VAR}` expanded
  - A root that does not exist or is not a directory produces a clear error for that root; other roots are still scanned
  - Scanning is read-only; the command creates no files and modifies no directory it visits

- [ ] **P0**: A candidate is any directory whose root holds a valid maester manifest
  - A directory is offered only if its manifest parses and passes schema validation
  - A directory with an invalid manifest is reported in a separate "skipped" list with the validation reason, so the user can fix it
  - Version-control metadata directories and dependency directories are never descended into
  - The citadel's base directory, every configured destination, and the subtree beneath any already-registered path source are never descended into

- [ ] **P0**: Already-registered sources are recognized and skipped
  - A candidate whose resolved path equals an existing path source's resolved path is listed as "already registered as `<name>`" and not offered
  - A candidate that is a git checkout whose remote origin matches an existing url source is listed as "already registered as `<name>` (remote)" and not offered
  - The skipped list is shown alongside the candidates so the user can see what discovery found in total

- [ ] **P0**: User reviews candidates before anything is written
  - Each candidate is shown with its resolved path, a proposed name, and the manifest's description when one is declared
  - The proposed name is derived from the directory name as a valid slug; when it collides with an existing source or another candidate, a distinguishing suffix is proposed
  - The user can accept or reject each candidate, and edit the name and description of accepted ones
  - Rejecting every candidate exits with a clear "nothing registered" message and no config change

- [ ] **P0**: User chooses the registration form per candidate
  - Every candidate can be registered as a path source; this is the pre-selected form
  - A candidate that is a git checkout with a remote origin can instead be registered as a url source using that origin and the checkout's current branch as the ref
  - The chosen form is reflected in the written config entry and round-trips through validation without edits

- [ ] **P0**: Accepted candidates are written to the citadel configuration
  - Entries are appended through the same mechanism as the add-source flow, preserving existing entries, ordering, and unrelated top-level fields
  - The write is atomic: an interrupted run leaves the previous config intact
  - The command ends by naming the entries written and the sync command that will surface them
  - Exit code is zero on success (including "nothing to register"), non-zero on error or cancellation

- [ ] **P1**: Discovery runs non-interactively when asked
  - A flag accepts every candidate with its proposed name, description, and default registration form, without prompting
  - A separate flag emits the candidate and skipped lists as structured output and writes nothing
  - Structured output includes, per candidate, the resolved path, proposed name, manifest description, whether a git origin was detected, and the reason for any skip

- [ ] **P1**: Scan depth is bounded and adjustable
  - The default depth covers immediate children and a small number of levels beneath them
  - A flag raises or lowers the depth; a value below one is rejected
  - The output reports the roots and depth that were scanned so results are reproducible

- [ ] **P1**: Discovery is reachable from the top-level menu
  - When the current repository has a citadel, the menu offers "Discover local maesters"
  - When it does not, the option is absent and invoking the subcommand directly exits with a clear error pointing at citadel initialization

- [ ] **P2**: Discovery pre-fills citadel-side metadata from the manifest
  - When a candidate's manifest declares a top-level description or tags, they are proposed as the source's `description` and `tags`
  - The user can edit or clear them before writing
  - Candidates without manifest metadata are offered with empty fields

## 5. Dependencies

- **Local Maesters** ([local-maesters.md](local-maesters.md)) — discovery registers path sources; it requires the `path` source kind to exist.
- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — candidates are identified by the manifest this feature defines; the P2 pre-fill reads its top-level description.
- **Config Editing** ([config-editing.md](config-editing.md)) — discovery writes through the same add-source mechanism and inherits its atomicity and preservation guarantees.
- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — the top-level menu entry appears only in a citadel-bearing repository.

**External dependencies:** None. Detecting a git origin reads the checkout's local metadata only and performs no network calls.

## 6. Assumptions & Risks

**Assumptions:**
- Maesters near a citadel are most often siblings of it, so the parent directory is the right default root.
- A valid manifest is a sufficient signal of intent to be consumed; directories without one are not offered.
- Users prefer confirming a list once over typing entries individually, and prefer that the config remain the sole declaration of what the citadel contains.
- A human review step is acceptable friction for the safety it buys; dynamic sync-time discovery is intentionally not offered.

**Risks:**
- **Deep or large trees make scanning slow.** *Mitigation:* bounded depth by default, aggressive pruning of known-noisy directories, and the reported scan parameters so users can narrow roots.
- **Wrong default form for team citadels.** Registering by path produces machine-specific entries that teammates cannot use. *Mitigation:* the url form is offered whenever a git origin exists, and the review screen labels path entries as local.
- **Name collisions produce unhelpful slugs.** *Mitigation:* collisions are surfaced in review with a proposed suffix the user can override.
- **A candidate inside another candidate.** Nested manifests could register overlapping trees. *Mitigation:* a discovered directory's subtree is not descended into, so only the outermost manifest is offered.

## 7. Success Metrics

- Registering N sibling maesters requires one command and one review pass, with no path or name typed by hand in the default case.
- Re-running discovery immediately after a successful run offers zero new candidates and skips every previously registered one.
- JSON mode leaves the working tree byte-identical, verified by a content comparison before and after.
- Every entry discovery writes passes citadel config validation on the next sync without manual edits.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
