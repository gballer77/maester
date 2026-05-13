---
spec-version: v1
---

# Citadel Base Directory

## 1. Overview

**Feature name:** Citadel Base Directory

**Summary:** A top-level configuration field on the citadel (`baseDir`) that controls the parent folder under which every maester and raven is surfaced by default, replacing the previously hardcoded `citadel/` root. Per-source `destination` overrides continue to win unchanged.

**Problem being solved:** The default destination root is currently hardcoded as `citadel/<source-name>/`, so any project that wants its synced content under a different parent folder (e.g. `vendor/`, `docs/external/`, `third-party/`) must set a `destination` on every single source. This is repetitive, error-prone (each new source must remember the prefix), and makes the intent ("all my synced content lives under X") implicit rather than declarative. A single top-level knob expresses the intent once, applies it uniformly, and keeps per-source overrides available for the genuine exceptions.

## 2. Users & Use Cases

**Primary users:**
- Repository owners standardizing where third-party / synced content lives in their tree
- Engineers integrating maester into a project whose layout conventions don't match `citadel/`
- Teams maintaining many sources who don't want to repeat a path prefix on every entry

**Key use cases:**
1. **Project uses a non-`citadel/` convention.** A team prefers `vendor/` for all synced external content. They set `baseDir: "vendor"` once at the top of the config, and every source defaults to `vendor/<source-name>/` without per-source paths.
2. **Bulk relocation of many sources.** A project with a dozen configured sources wants to move them all under `docs/external/`. The user updates `baseDir` once instead of editing twelve `destination` fields.
3. **Mixed layout with one exception.** A project sets `baseDir: "vendor"` for the common case, but a single source needs to land at the repo root (e.g. `.github/`). The user sets `destination: ".github/workflows-shared"` on just that one entry; everything else follows the base directory.
4. **First-time init with a custom layout.** During citadel initialization, the user is prompted for the base directory and accepts `citadel` (the default) or types their preferred root. The choice is captured in the generated config.

## 3. Scope

**In-scope:**
- A top-level `baseDir` field on the citadel configuration schema
- Default destination resolution for every source becomes `<baseDir>/<source-name>/` when no per-source `destination` is set
- Backward compatibility: configs that omit `baseDir` behave identically to today (default base is `citadel`)
- The citadel initialization walkthrough prompts for `baseDir`, pre-filled with the conventional default
- The same path-safety rules that apply to per-source `destination` apply to `baseDir` (repo-relative, no leading `/`, no `..` segments)
- Destination-collision detection across all sources continues to work correctly after the new resolution rule
- Updating the in-tree documentation that describes the destination convention (config writer header / generated comments) to reflect the new field

**Out-of-scope:**
- Migrating existing on-disk content when a user changes `baseDir` after a previous sync (the new sync writes to the new location; old directories are left untouched)
- A `maester move` / `maester relocate` command that physically rewrites destinations on disk
- Changing the cache directory layout (the cache is a separate concern and is not affected by `baseDir`)
- Per-kind base directories (e.g. one base for maesters, another for ravens) — out of scope for this feature
- Templating or variable substitution inside `baseDir` (e.g. `${PROJECT}/citadel`)

**Deferred ideas:**
- A warning at sync time when the old base directory still contains citadel-produced content that is now orphaned by a `baseDir` change (a future quality-of-life signal)
- A guided "rebase destinations" verb that moves existing synced content from the old base to the new one
- Per-kind base directories if a real use case emerges

## 4. Capabilities

- [ ] **P0**: User can declare a top-level `baseDir` in the citadel config
  - The schema accepts an optional string `baseDir` at the top level of the citadel configuration
  - When provided, every source whose `destination` is unset resolves to `<baseDir>/<source-name>/` at the repository root
  - When `baseDir` is omitted, behavior is identical to the prior default (`citadel/<source-name>/`)
  - Setting `baseDir` does not affect sources that declare their own `destination`

- [ ] **P0**: `baseDir` is validated by the same path-safety rules as per-source `destination`
  - Empty strings, leading `/`, and any `..` segment are rejected with a clear error pointing at the `baseDir` field
  - Invalid `baseDir` values cause config validation to fail before any sync work is attempted
  - Whitespace-only values are rejected

- [ ] **P0**: Destination-collision detection continues to work correctly with `baseDir`
  - Two sources that resolve to the same directory under the new base are rejected with a clear error naming both sources
  - A source with an explicit `destination` that collides with another source's `<baseDir>/<name>/` default is also rejected
  - The error message references the resolved absolute path so the conflict is unambiguous

- [ ] **P0**: Sync uses `baseDir` when resolving each source's default destination
  - A fresh sync with `baseDir: "vendor"` writes every default-destination source to `vendor/<source-name>/`
  - Sources with a per-source `destination` continue to land exactly at that path, regardless of `baseDir`
  - Idempotent re-runs against the configured `baseDir` produce no spurious file modifications

- [ ] **P0**: The init walkthrough prompts for `baseDir` and records the user's choice
  - During citadel initialization, the user is shown a prompt for the base directory with the conventional default pre-filled
  - Accepting the default produces a config equivalent to today's behavior (whether the field is written explicitly or omitted is an implementation choice, but the resolved behavior must match)
  - A user-entered base directory is validated using the same rules as `baseDir` and re-prompted on invalid input

- [ ] **P1**: Generated config documentation reflects the new field
  - Any header / comment block written to the citadel config file by init mentions `baseDir` and its default
  - Any in-repo human-facing documentation that previously stated content lands under `citadel/` is updated to describe the new resolution rule (`<baseDir>/<name>/` with the documented default)

- [ ] **P1**: Changing `baseDir` after a previous sync is non-destructive
  - When a user updates `baseDir` and re-syncs, sync writes to the new resolved destinations and does not delete, move, or touch the previously-populated directories under the old base
  - The previously-populated directories are treated as the user's responsibility to remove
  - Sync does not refuse to run because of orphaned directories under the old base

## 5. Dependencies

- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — the init walkthrough must be extended to prompt for `baseDir` and persist the choice into the generated config.
- **Maester Sync** ([maester-sync.md](maester-sync.md)) — destination resolution at sync time must read `baseDir` instead of the hardcoded default; the destination-collision check must operate on the new resolution rule.
- **Citadel Ravens** ([citadel-ravens.md](citadel-ravens.md)) — `baseDir` applies uniformly to both maesters and ravens; the raven entries' default destination must follow the same rule.

**External dependencies:** None.

## 6. Assumptions & Risks

**Assumptions:**
- The same path-safety constraints currently enforced on per-source `destination` are appropriate for `baseDir`; no new path-shape rules are needed.
- Users who already rely on the implicit `citadel/` default will see no behavior change when they upgrade — the field is purely additive when omitted.
- The cache directory layout (`.maester/cache/`) is intentionally orthogonal to `baseDir` and is not affected by this feature.
- It is acceptable for a `baseDir` change to leave the previous root directory in place; users will manage cleanup with normal git operations.

**Risks:**
- **Surprise relocation on upgrade.** If `baseDir` is mistakenly treated as required by stricter tooling, existing configs could break. *Mitigation:* the field is optional in the schema; omission is explicitly equivalent to the prior default.
- **Collision rule changes silently.** Resolving defaults through `baseDir` could allow previously-valid configs to start colliding (e.g. two configs that both used the implicit default in different ways). *Mitigation:* the collision rule already operates on the fully resolved path; adding a `baseDir` segment does not change its strictness — it just changes the resolved values both sides compare against.
- **User confusion about orphaned old directories.** A user who changes `baseDir` may not realize the old directories still exist on disk. *Mitigation:* this is acknowledged scope (P1 capability above documents the non-destructive behavior). A future deferred capability may surface a warning at sync time.
- **Init walkthrough length.** Adding another prompt could lengthen the walkthrough. *Mitigation:* the prompt has a pre-filled default that is one Enter keystroke to accept; users who don't care pay no cost.

## 7. Success Metrics

- A project with N configured sources can change the destination root for all of them by editing exactly one line of config (verified by comparing pre- and post-feature config diffs for a representative project).
- 100% of existing v2 citadel configs continue to validate and sync to their prior destinations when `baseDir` is omitted (no observable behavior change without an opt-in).
- A misconfigured `baseDir` (leading `/`, `..`, empty string) is always rejected at config-validation time, never reaching the sync phase.
- The init walkthrough captures a custom `baseDir` end-to-end (prompt → validation → committed config → resolved sync destinations) in a single run.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
