---
spec-version: v1
---

# Connector Env-Var Seeding into MCP Host Registrations

## 1. Overview

**Feature name:** Connector Env-Var Seeding into MCP Host Registrations

**Summary:** Extends the per-host MCP server registration writers defined by [Traveling Maesters](traveling-maesters.md) so that every env-var **name** declared by a connector's `auth.envVar` is automatically forwarded into the host platform's MCP-launcher configuration, using each host's native pass-through mechanism. Codex CLI gains an `env_vars = ["NAME", ...]` array (its built-in shell-pass-through list). Claude Code gains an `env = { NAME = "${NAME:-}" }` object that uses its documented `${VAR}` expansion to read the name from the user's shell at MCP-server-spawn time. Cursor — which has no working config-file pass-through mechanism — relies on its natural parent-process env inheritance; the installed Grand Maester artifact for Cursor gains a short note listing the required env-var names so the user knows what to export in the shell that launches Cursor. No secret values are ever written to disk by the framework; only env-var names appear in any file maester produces.

**Problem being solved:** A connector with `auth.type === "token"` reads its credential from `process.env[auth.envVar]` at MCP-tool-invocation time. Today the per-host MCP registration writers emit only `command` and `args`, so the MCP subprocess spawned by the host platform has no path to receive the credential — even when the user has exported the env var in the shell that launched the host. Codex in particular runs each MCP server with a sanitized env list by default; the variable simply never reaches the maester subprocess, and every tool call ends in a `missing-env-var` envelope. The user-visible symptom (`"GITLAB_TOKEN is not set"` despite having exported it before launching codex) is confusing and contradicts the framework's documented "export the env var in your shell and the next agent session picks it up" promise. Closing this gap is required for the [GitLab Issues Connector](gitlab-issues-connector.md) — the first concrete connector — to work end-to-end on a fresh install, and applies to every future connector type that uses token auth.

## 2. Users & Use Cases

**Primary users:**
- AI-assisted developers who have configured one or more token-auth connectors in their citadel and use Codex CLI, Claude Code, or Cursor as their MCP-capable host
- Citadel maintainers responsible for the team's `citadel.yaml`, who expect the documented env-var name to be the only thing committed and the only thing each developer has to set locally
- Connector implementers adding new connector types — they rely on `auth.envVar` "just working" without each new type having to teach its own host-specific env-var handshake

**Key use cases:**
1. **Fresh install on Codex CLI.** A developer runs `maester init` and registers a GitLab Issues connector with `auth.envVar: GITLAB_TOKEN`. The codex MCP registration writer emits `env_vars = ["GITLAB_TOKEN"]` into `.codex/config.toml`. The developer exports `GITLAB_TOKEN` in their shell, launches `codex`, and the very first `team_gl__list_issues` tool call succeeds — no manual edit to the MCP config required.
2. **Fresh install on Claude Code.** Same flow, but the Claude Code writer emits an `env` block of `{ "GITLAB_TOKEN": "${GITLAB_TOKEN:-}" }` into `.mcp.json` (project scope) or `~/.claude.json` (user scope, as appropriate). Claude Code expands the placeholder against the user's shell env at server-spawn time and the call succeeds. An unset env var does not crash Claude Code's config parser (because the `:-` default form is used); the call instead fails with the framework's normal `missing-env-var` envelope so the user gets the actionable error.
3. **Adding a connector after install.** A user runs `maester connector add` to add a second connector (e.g. `linear-issues` with `auth.envVar: LINEAR_TOKEN`). The standalone management flow refreshes every installed MCP-host registration; both Codex's `env_vars` array and Claude Code's `env` block gain the new name (de-duplicated), preserving any user-added entries.
4. **Removing a connector.** A user runs `maester connector remove team-gl`. If no other connector still references `GITLAB_TOKEN`, the next refresh strips that name from the managed set in every host's MCP block. Names the user added by hand inside the maester block (e.g. a debug flag) remain.
5. **Token rotation.** A user rotates the value of `GITLAB_TOKEN` in their shell. No config file changes; no `maester init`/`add` re-run needed. The next agent-session restart (which spawns a fresh MCP subprocess) picks up the new value through the forwarding mechanism the writer already put in place.
6. **Cursor user.** A developer using Cursor reads the installed Grand Maester artifact, sees the listed required env-var names (`GITLAB_TOKEN`, `LINEAR_TOKEN`), exports them in their shell, and launches Cursor from that shell. Cursor inherits the env, spawns the maester MCP subprocess with the env intact, and the calls succeed. The cursor `mcp.json` env block stays empty (the writer does not put anything host-incompatible into it).
7. **User-added env entries survive refresh.** A developer manually adds `MY_DEBUG_FLAG` to Codex's `env_vars` array. Running `maester connector add` later refreshes the file but the union semantics keep `MY_DEBUG_FLAG` intact alongside the framework-managed connector env-var names.

## 3. Scope

**In-scope:**
- The per-host MCP registration writers shipped by [Traveling Maesters](traveling-maesters.md) compute the **set of env-var names** to forward by reading every connector entry in the current `citadel.yaml` and collecting each entry's `auth.envVar` (when `auth.type === "token"`). Source-side `auth.envVar` declarations are explicitly excluded — sources are consumed by `maester sync`, which runs as a CLI verb in the user's terminal and already inherits the shell's env.
- The set is de-duplicated and stable-sorted (e.g. lexicographic) so writer output is deterministic and the file is friendly to diffs and idempotency checks.
- **Codex** writer: emits `env_vars = ["NAME1", "NAME2", ...]` inside the `[mcp_servers.maester]` table. An empty set is written as an empty array (or the key is omitted entirely; both are equivalent and the writer picks one deterministically).
- **Claude Code** writer: emits `env = { "NAME1": "${NAME1:-}", "NAME2": "${NAME2:-}", ... }` inside the `mcpServers.maester` object. The `:-` (empty-default) form is used so an unset env var on the user's machine does not cause Claude Code to fail to parse the whole MCP config; the resulting empty value flows through to the maester subprocess, which then returns the framework's normal `missing-env-var` envelope at tool-invocation time.
- **Cursor** writer: the `env` block is **not** populated for connector-derived names. Cursor's MCP subprocess inherits the env Cursor itself was launched with, so an exported env var reaches the subprocess via process inheritance. Cursor's writer is otherwise unchanged.
- **Per-host artifact note** for Cursor: the Grand Maester skill installer's Cursor target adds a short note inside its installed artifact listing the required env-var names and instructing the user to export them in the shell that launches Cursor. The note's content is derived from the same `citadel.connectors` scan; an empty connector list yields no note. The note lives inside the artifact's managed region so it refreshes automatically on the next skill install/upgrade.
- **Union semantics** ("do not clobber"): for each host that supports an env list, the writer treats its emitted set as a **managed subset** within the host's native env field. On every refresh:
  - Framework-managed entries (those derived from the current `citadel.connectors`) are written.
  - Any entry present in the existing file that is not framework-managed is preserved verbatim.
  - Framework-managed entries that are no longer in the citadel's connector set are removed.
  - The merged result is de-duplicated and stable-sorted.
- **Refresh triggers** — env-var seeding rides on the existing `refreshMcpRegistrations` invocations:
  - `maester init` (per [Citadel Initialization](citadel-initialization.md))
  - `maester connector add` and `maester connector remove`
  - Grand Maester skill install / upgrade (per [Grand Maester Skill](grand-maester-skill.md))
  - No new refresh triggers are introduced by this feature.
- **Idempotency** — running any refresh twice in a row produces byte-identical files (existing framework guarantee; this feature must not regress it).
- **Validation** — the writer continues to validate env-var names against the existing `ENV_VAR_RE` regex (`/^[A-Z][A-Z0-9_]*$/`) before emitting them. Any name that fails validation is dropped from the emitted set with a stderr warning naming the offending connector and the offending name; the rest of the set is still written. (In practice the citadel schema already rejects malformed names at config-load time, but the writer is defensive.)
- **Compatibility with existing files** — when a writer encounters an existing `[mcp_servers.maester]` block that already has an env entry the writer would otherwise add, the writer reuses the existing entry rather than rewriting it (preserves user-chosen formatting that the TOML/JSON library would otherwise normalize).

**Out-of-scope:**
- Storing or transmitting env-var **values** in any maester-written file. The framework's "names only, never values" posture from [Traveling Maesters](traveling-maesters.md) is preserved verbatim.
- A wrapper-script approach for Cursor (e.g. `cursor-wrapper.sh` that sources a `.env` file) — recorded as a deferred idea; v1 relies on Cursor's process-env inheritance.
- A Cursor-side workaround that injects `${env:VAR}` syntax — Cursor's MCP config does not document this and the community evidence is that it does not work; emitting it would be wrong.
- Live `citadel.yaml` reload that re-seeds env-var names mid-session — same out-of-scope posture as the framework's overall live-reload behavior.
- Sourcing env-var values from external secret managers (1Password CLI, AWS Secrets Manager, macOS Keychain, etc.) — deferred.
- Per-connector `env` overrides where one connector wants to forward a name to the MCP subprocess under a different alias — connectors get the literal `auth.envVar` name; no aliasing.
- Source-side env-var seeding (git auth env vars). Sources run via `maester sync` in the user's shell and don't participate in MCP-server spawning.
- Generic env-var forwarding unrelated to connectors (e.g. forwarding `NODE_OPTIONS` or `DEBUG`). Only `connectors[*].auth.envVar` participates in the managed set. Users can hand-add anything else and the union semantics preserve it.

**Deferred ideas:**
- Optional `cursor-wrapper` mode (`maester mcp register --cursor-wrapper`) that emits a generated shell wrapper sourcing a user-managed `.env` file before launching `maester mcp` — covers the case where the user cannot reliably control Cursor's parent-process env (e.g. Cursor launched from a GUI launcher with no shell ancestry).
- Integration with named secret managers — a per-citadel "use 1Password" or "use macOS Keychain" mode that emits an `op run --env-file=... -- npx baller-maester mcp` style command for hosts that allow command wrapping.
- A `maester mcp doctor` (or extension to existing diagnostic commands) that connects to each host's MCP config, looks up every framework-managed env-var name, reports which are currently set in the user's shell, and surfaces the missing ones without invoking a tool.
- Per-connector env-var aliasing (e.g. connector says "expose `MY_TOKEN` to the subprocess but read it from `TEAM_TOKEN` in my shell").
- Auto-detecting when Codex's `[shell_environment_policy]` block is set restrictively and warning the user that even `env_vars` pass-through may be blocked.
- Honoring future MCP standards for credential delegation (the protocol may eventually surface a first-class credential channel that bypasses the env-var dance entirely).

## 4. Capabilities

- [x] **P0**: Codex MCP writer seeds `env_vars` with every connector-declared env-var name
  - Reading `citadel.yaml`, the writer collects each connector's `auth.envVar` (where `auth.type === "token"`), de-duplicates the set, stable-sorts it, and emits `env_vars = ["NAME1", "NAME2", ...]` inside `[mcp_servers.maester]` in `.codex/config.toml`.
  - An empty set emits an empty array or omits the key — the writer picks one deterministically so the output is identical across runs.
  - When `auth.type === "none"` (or `auth` is omitted), the connector contributes nothing to the set.
  - Names that fail the framework's `ENV_VAR_RE` validation are dropped from the emitted set, a stderr warning names the offending connector + name, and the rest of the set is written.
  - The writer remains idempotent — running it twice in a row produces byte-identical files.

- [x] **P0**: Claude Code MCP writer seeds `env` with `${VAR:-}` placeholders for every connector-declared env-var name
  - The writer emits an `env` object inside the `mcpServers.maester` block (either `.mcp.json` for project scope or `~/.claude.json` for user/local scope, matching wherever the existing writer puts the maester block) where each key is a connector-derived env-var name and each value is the literal string `${VAR:-}` (with `VAR` substituted by the actual name).
  - The `:-` empty-default form is used so an unset env var on the user's machine does not cause Claude Code to fail to parse the whole `.mcp.json` (Claude Code hard-fails the config when a required `${VAR}` has no default).
  - The writer is idempotent — re-running it produces byte-identical files when neither the citadel nor the existing file contents have changed.
  - When the connector-derived set is empty, the writer leaves the `env` block untouched if it already exists with user-added entries, or omits it entirely if no user-added entries are present.

- [x] **P0**: Cursor writer is unchanged for connector-derived env vars
  - The Cursor MCP writer does not emit any connector-derived names into `mcp.json`'s `env` block (no `${env:VAR}` substitution, no literal-value injection).
  - Cursor inherits env vars from its parent process and forwards them to the MCP subprocess; this remains the documented contract for Cursor users.
  - The writer remains idempotent and continues to preserve any user-added entries already present in the file.

- [x] **P0**: User-added env entries are preserved across refreshes (union semantics)
  - For Codex: any entry in the existing `env_vars` array that is not in the current framework-managed set survives the next refresh, joined to the framework-managed names, de-duplicated, and stable-sorted.
  - For Claude Code: any key in the existing `env` object that is not in the current framework-managed set survives the next refresh with its existing value intact. Framework-managed keys are overwritten with the `${VAR:-}` placeholder.
  - For Cursor: any user-added entries inside the existing `env` block are preserved (the writer does not write its own connector-derived names, but it does not erase existing ones either).
  - De-duplication is case-sensitive (matches the regex's case-sensitivity).

- [x] **P0**: Removing a connector strips its env-var name on the next refresh
  - When the last connector that referenced a given env-var name is removed from `citadel.yaml`, the next refresh removes that name from the framework-managed subset in every host's MCP block.
  - User-added entries (per the previous capability) are not stripped.
  - The `maester connector remove` flow's existing post-removal refresh triggers this behavior — no new code path is introduced.

- [x] **P0**: Refresh hooks into the existing trigger points without introducing new ones
  - `maester init`, `maester connector add`, `maester connector remove`, and Grand Maester skill install/upgrade all already call `refreshMcpRegistrations`. This feature's logic lives inside the per-host writers those calls invoke; no new public command or new refresh trigger is added.
  - When `refreshMcpRegistrations` runs with a `scopeTo` filter (per the existing API), only the in-scope hosts' env lists are updated.

- [x] **P0**: No env-var values are ever written to any file the writer produces
  - The writer never reads `process.env[name]` for any connector-derived env-var name.
  - The writer never inlines a token value into Codex's `env_vars`, Claude Code's `env`, or Cursor's `env`.
  - The "names only, no values" invariant is the same one [Traveling Maesters](traveling-maesters.md) commits to for the citadel config; this feature extends it to MCP-host artifacts.

- [x] **P1**: Grand Maester Cursor artifact lists required env-var names
  - When the Grand Maester skill installs (or upgrades) for the Cursor target on a citadel with one or more token-auth connectors, the installed artifact gains a short, fixed-shape note inside its managed region listing the required env-var names and instructing the user to export them in the shell that launches Cursor.
  - When the citadel has no connectors (or only `auth.type === "none"` connectors), the note is omitted.
  - The note is regenerated on every install/upgrade, so adding or removing a connector causes the next skill refresh to update the list.
  - Other targets (Claude Code, Codex, Generic AGENTS.md) do not get this note — Codex and Claude Code seed the names in the MCP config directly, and the AGENTS.md target is not an MCP host.

- [x] **P1**: Writer output is diff-friendly across refreshes
  - The emitted env list (whatever the host's native shape) is stable-sorted so two refreshes with the same inputs produce byte-identical files.
  - When the citadel changes only the order of connector entries (not the set of `auth.envVar` names), the writer's output does not change.
  - When a connector is renamed but its `auth.envVar` is unchanged, the writer's emitted env list does not change.

- [x] **P1**: Writer surfaces actionable diagnostics on failure
  - A connector whose `auth.envVar` fails the framework's regex validation triggers a stderr warning naming the connector and the offending value; the rest of the set is still written. The warning is one short line per offender, not a stack trace.
  - A host config file that exists but cannot be parsed (corrupt TOML/JSON) causes the writer for that host to return `action: "failed"` with the parser's message; other hosts' refresh continues independently.

- [ ] **P2**: A diagnostic surface lists the connector-derived env vars the writer would emit per host
  - A read-only verb (or extension to an existing diagnostic command, e.g. `maester connector tools` per the framework PRD's deferred idea) prints, for each installed MCP-capable host, the connector-derived env-var names the writer would currently emit — so the user can verify the seeded set before invoking a refresh.
  - The output also names which connector(s) contributed each env var (useful when several connectors share a token-env-var name).
  - Read-only — does not write anything to disk.

## 5. Dependencies

- **Traveling Maesters** ([traveling-maesters.md](traveling-maesters.md)) — Owns the per-host MCP registration writers, the `refreshMcpRegistrations` orchestration, the `citadel.connectors` schema, the env-var-name regex validation, and the "names only, no values" security invariant. This feature extends those writers and reuses every existing trigger point; it does not introduce new framework-level concepts.
- **Grand Maester Skill** ([grand-maester-skill.md](grand-maester-skill.md)) — Owns the per-target install/upgrade flow. The P1 capability to add a required-env-var note to the Cursor artifact extends the skill installer's existing managed-region writing for that target. No other artifact is touched.
- **GitLab Issues Connector** ([gitlab-issues-connector.md](gitlab-issues-connector.md)) — The first concrete consumer of the framework's `auth.type === "token"` path. This feature unblocks that connector's documented end-to-end flow on Codex; until env-var seeding lands, the connector fails with `missing-env-var` on Codex even when the user has exported the credential.
- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Triggers `refreshMcpRegistrations` after the optional connector-registration step. This feature inherits that trigger and does not modify the init walkthrough's prompts.

**External dependencies:**
- Codex CLI's `env_vars` field on `[mcp_servers.<name>]` — pass-through-by-name list, native to codex.
- Claude Code's `${VAR}` / `${VAR:-default}` expansion in `.mcp.json` and `~/.claude.json` — documented native feature.
- Cursor's parent-process env inheritance — the documented behavior when no working config-file mechanism exists.
- The Model Context Protocol — consumed indirectly through the framework; this feature does not touch the wire protocol.

## 6. Assumptions & Risks

**Assumptions:**
- Codex's `env_vars` pass-through, Claude Code's `${VAR}` expansion, and Cursor's parent-process env inheritance are stable behaviors for the lifetime of v1 of this feature. Vendor regressions would surface in the same agent-session failures the feature is designed to prevent; the fix would be a per-host writer update rather than a framework redesign.
- The set of MCP-capable hosts the framework supports stays bounded to Codex, Claude Code, and Cursor in v1. Future hosts inherit the same "per-host writer owns the env-forwarding decision" pattern.
- A connector's `auth.envVar` name is the right granularity for the managed set. Two connectors that share a `auth.envVar` name share the same shell-exported token (e.g. two GitLab Issues connectors against different projects on the same host). This is already the framework's contract.
- A user editing the maester block by hand is the rare case, not the common case. The union semantics protect against silent loss but are not a primary user surface.
- The `:-` empty-default form in Claude Code's `${VAR:-}` is the right tradeoff — it sacrifices "Claude Code hard-fails fast when you forgot to export the token" for "the framework's own missing-env-var envelope is the canonical surface for the missing-credential failure". The latter is the framework's documented contract.

**Risks:**
- **Vendor format drift.** A host may change its env-var pass-through syntax (e.g. Codex renaming `env_vars`, Claude Code dropping `${VAR}` expansion). *Mitigation:* per-host writers are isolated; each can be updated independently. The framework's error model already surfaces `missing-env-var` at tool-invocation time, so a regression produces a clear, actionable failure rather than a silent miss.
- **Claude Code `${VAR:-}` empty-string vs. unset confusion.** A user who exported the variable with an empty string would currently get the same `missing-env-var` envelope as a user who did not export it at all (because the framework's [resolveAuth](src/core/auth/resolver.ts#L11-L17) treats `length === 0` as missing). *Mitigation:* this matches existing framework behavior; the `:-` form is a deliberate consistency choice with what the framework already considers "missing."
- **User loses unexpected entries.** If the user added an env entry inside the maester block expecting it to survive, but the writer's "framework-managed set" detection is imperfect, the user could lose data. *Mitigation:* the managed-set is purely a function of `citadel.connectors[*].auth.envVar` — well-defined and inspectable. The merge logic explicitly treats anything not in that set as user-owned and preserves it verbatim. The diagnostic capability (P2) lets users see what the writer would emit before invoking it.
- **Cursor users hit a friction wall.** A developer using Cursor sees the GitLab Issues connector "working" on Codex / Claude Code but failing on Cursor with the missing-env-var envelope. *Mitigation:* the P1 capability adds an explicit "export these env vars in the shell that launches Cursor" note to Cursor's installed artifact, making the contract visible. The deferred `cursor-wrapper` idea exists for environments where shell inheritance isn't viable.
- **Codex `[shell_environment_policy]` blocking pass-through.** A user whose global codex config strips env vars aggressively (e.g. `inherit = "none"`) finds even `env_vars` doesn't help because there's nothing for Codex to read. *Mitigation:* the framework's `missing-env-var` envelope surfaces the failure clearly. A deferred capability could detect this configuration and surface a more specific warning.
- **Stable-sort assumption.** A future change that uses insertion order instead of stable-sort would silently break idempotency tests. *Mitigation:* explicit acceptance criteria call out byte-identical output across refreshes; tests anchor the behavior.
- **TOML/JSON library round-tripping.** The TOML library used by the codex writer does not preserve comments (already documented in the writer's docstring); a writer that round-trips an entire existing file could subtly alter formatting that the user cares about. *Mitigation:* the union-merge logic is field-scoped (only `env_vars`/`env` is touched), not whole-file. The idempotency requirement catches any regression.

## 7. Success Metrics

- A developer on a fresh `maester init` with a token-auth connector and an exported env var can invoke a connector tool successfully on Codex CLI or Claude Code in the first agent session — no manual MCP config edit required and no `missing-env-var` envelope on the happy path.
- Across all supported MCP-capable hosts (Codex, Claude Code, Cursor), zero secret values are written to any file by maester's writers; only env-var names appear.
- Running `refreshMcpRegistrations` twice in a row on an unchanged citadel produces byte-identical files for every host that touches an env list.
- Adding a connector after install adds its `auth.envVar` to the managed set in every applicable host's MCP block in one refresh; removing the connector removes it again — both without disturbing any env entry the user had added by hand.
- A Cursor user who reads the installed Grand Maester artifact knows exactly which env-var names to export in their shell — the list is dynamic, generated from the same `citadel.connectors` scan the other writers use.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
