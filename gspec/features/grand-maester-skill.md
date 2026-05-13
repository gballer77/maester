---
spec-version: v1
---

# Grand Maester Skill

## 1. Overview

**Feature name:** Grand Maester Skill

**Summary:** An optional, installable agent integration that helps whichever AI coding agent the user runs reason over the contents of a citadel. The Grand Maester is *citadel-aware* (knows where aggregated content lives and how it is organized), *state-aware* (treats `canon` files as authoritative and `draft` files as informational context), and *freshness-aware* (calls `maester status` before substantial citadel reads and prompts a sync when sources are behind). It installs as an active runtime component on agent platforms that support hooks/automation and degrades to instruction-only integration on platforms that do not. Installation is offered (recommended) during citadel initialization and is also available via a standalone command for later install, re-install, agent switch, or upgrade.

**Problem being solved:** Today a citadel can be assembled correctly and still be underused: a host AI agent has no reliable way to know that the citadel exists, what is canonical inside it, or whether the local copy is current. Agents either ignore citadel content, mix authoritative and draft material indiscriminately, or read stale content because nobody told them to check first. The Grand Maester turns the citadel into a first-class context surface for the host agent — pointing it at the right files, encoding the canon-over-draft policy, and inserting a freshness check at the moment it matters (before the agent reads the docs) so that "use the citadel" stops being a manual habit and starts being a property of the working tree.

## 2. Users & Use Cases

**Primary users:**
- AI-assisted developers running a coding agent (e.g., Claude Code, Codex CLI, Cursor, or any agent configured via a generic `AGENTS.md`) inside a citadel-bearing repository
- Citadel maintainers who want consistent, opinionated agent behavior across the team without each developer having to hand-tune agent rules
- Repository owners running citadel initialization who want the integration set up in one walkthrough rather than as a follow-up chore

**Key use cases:**
1. **Install at init.** A developer initializes a citadel via the maester CLI and, when asked, opts in to install the Grand Maester. The walkthrough asks which agent(s) to target and writes the corresponding integration artifacts into the repository before init completes.
2. **Pre-read freshness check.** An agent is about to read citadel content while answering a developer's question. The Grand Maester (where the host platform supports hooks/automation) runs `maester status` first; if any source is behind, the agent surfaces that and offers to sync before continuing.
3. **Canon-preferring answers.** A developer asks the agent a question that the citadel can answer. The agent cites `canon` files as authoritative and treats `draft` files as informational context only, surfacing state alongside the citation.
4. **Install after init.** A developer who initially declined the skill (or set up the citadel before this feature existed) runs the standalone install command later, picks an agent, and gets the same artifacts written without re-running init.
5. **Switch or add an agent target.** A team that moves from one coding agent to another runs the standalone command to install the integration for the new agent alongside (or replacing) the previous one.
6. **Upgrade an outdated skill.** A developer running a citadel set up against an older version of Maester runs the standalone command and gets the installed Grand Maester artifacts updated in place, preserving any sections the user has added.

## 3. Scope

**In-scope:**
- Opt-in installation step inside the citadel initialization walkthrough, recommended by default
- A target-agent selection step that supports v1 targets: **Claude Code**, **Codex CLI**, **Cursor**, and a **generic `AGENTS.md`** fallback for any other agent
- Multi-target install — the user can pick more than one agent in a single run
- Writing the appropriate per-target artifacts into the citadel repository (instruction files always; hook/automation scripts on platforms that support them)
- Encoding three behaviors in every installed target's artifacts:
  - **Citadel awareness** — where citadel content lives (under the configured base directory), how it is organized by source, and how to find the per-source layout
  - **State awareness** — prefer files whose resolved state is `canon` when answering authoritatively; allow `draft` files as informational context only; surface state alongside citations (see [Document State Tagging](document-state-tagging.md))
  - **Freshness awareness** — before substantial reads of citadel content, run `maester status`; on a non-zero (`behind` or `failed`) result, surface the verdict and offer to sync (see [Citadel Status](citadel-status.md) and [Maester Sync](maester-sync.md))
- "Active where supported" behavior — on targets that support hooks (e.g., Claude Code), the freshness check is wired as a pre-read hook; on targets that do not, the same behavior is encoded as instruction the host agent is expected to follow
- A standalone CLI command for skill management with at minimum three operations: install (idempotent), upgrade (preserves user-added sections), and target switch / add (add a new agent target to an installed skill)
- Idempotent file writes — installing or upgrading does not duplicate content, clobber user-added content in marked-managed regions, or unconditionally overwrite files the user owns
- Validation of the selected target(s) — unknown or unsupported target names are rejected before any file is written
- A small, citadel-aware helper that the installed Grand Maester can shell out to (e.g., a `maester` subcommand that returns, in agent-friendly form, "what canon files matter for topic X" or "give me the status verdict as a one-line summary") — used by the active-runtime integration to keep the agent's instructions short and the runtime behavior consistent

**Out-of-scope:**
- Uninstall as a first-class verb in v1 — users can remove the artifacts manually; a clean uninstall command is deferred
- Authoring or maintaining the *content* of agent-platform-specific runtime engines (hooks, rules, skill loaders) — the feature integrates with what each platform already provides
- A general-purpose plugin / skill marketplace for Maester — only the Grand Maester is shipped here
- Inventing a state vocabulary beyond what [Document State Tagging](document-state-tagging.md) defines (`canon` / `draft`)
- Performing the sync itself when freshness check fails — the Grand Maester surfaces the verdict and offers the sync; the actual sync is performed by [Maester Sync](maester-sync.md)
- Cross-machine settings sync — the installed artifacts live in the citadel repository alongside the existing committed config
- Network-based skill distribution / updates — the skill content ships with the installed `maester` package; "upgrade" means re-running install against the local install of `maester`
- Storing or transmitting any agent-platform credentials — none are required by this feature

**Deferred ideas:**
- Uninstall command (`maester skill uninstall`) that cleanly removes installed artifacts
- Additional target agents beyond the v1 four
- Per-target customization (e.g., user-defined canon weighting, custom freshness thresholds)
- A "what changed since last read" digest the Grand Maester can present to the agent after a sync
- A status-only / lightweight mode that suppresses the freshness check for short-lived sessions
- Telemetry or local logs of when the Grand Maester triggered a freshness check or canon recommendation
- Auto-upgrade prompt during `maester sync` (currently only the standalone command upgrades)
- A diagnostic command that introspects the installed skill and reports which integrations are wired and which targets are missing artifacts

## 4. Capabilities

- [x] **P0**: User is offered the Grand Maester install step during citadel initialization, recommended by default
  - The citadel-init walkthrough includes a clearly labeled "Install the Grand Maester agent skill?" prompt with "yes" as the default answer
  - Declining the prompt completes init normally and writes zero skill artifacts
  - Accepting the prompt advances to target-agent selection without leaving the walkthrough
  - The prompt appears only when init is otherwise going to succeed — it is not asked on cancellation paths

- [x] **P0**: User selects one or more target agents during install
  - Supported v1 targets are **Claude Code**, **Codex CLI**, **Cursor**, and a **generic `AGENTS.md`** fallback
  - The user can pick one or multiple targets in a single run; at least one must be selected to complete the install
  - Unknown / unsupported target identifiers (e.g., passed via flag) are rejected with a clear error before any file is written
  - The selection is presented in a way that makes the generic `AGENTS.md` option discoverable for agents not on the named list

- [x] **P0**: Install writes the correct per-target artifacts into the citadel repository
  - For each selected target, the install writes the integration artifact(s) at the path that target expects (e.g., a skill directory for Claude Code, a rules file for Cursor, an `AGENTS.md` file for Codex CLI / generic, etc.)
  - Each artifact carries a clearly marked managed region so future upgrades can update its content without clobbering user-added content
  - Artifacts are safe to commit — they contain no secret values and no machine-local paths
  - The install reports the exact files written at the end of the run so the user can verify

- [x] **P0**: Installed artifacts encode citadel awareness
  - The artifacts explain to the host agent that citadel content lives under the citadel base directory (see [Citadel Base Directory](citadel-base-directory.md)) and is organized into per-source subdirectories
  - The artifacts instruct the host agent to consult citadel content when answering questions the citadel covers, with a short, agent-friendly description of how to identify relevant files
  - The instruction text references the citadel by its repository-local path so the agent can find it without configuration

- [x] **P0**: Installed artifacts encode canon-preferring, draft-tolerant state awareness
  - The artifacts instruct the host agent to treat files whose resolved state is `canon` as authoritative when answering
  - `draft` files are surfaced as informational context only — the agent may cite them but must mark them as draft when doing so
  - State is read inline from each file using the conventions defined by [Document State Tagging](document-state-tagging.md); the agent is told to look there and is not expected to consult any external index
  - When an answer cites a draft file, the cited material is presented alongside the file's `state` so the developer can tell

- [x] **P0**: Installed artifacts encode freshness awareness via a pre-read status check
  - Before substantial citadel reads in a session, the integration causes `maester status` to run and the result to be observed by the host agent
  - On a `behind` or `failed` verdict, the host agent surfaces the verdict to the developer and offers to run `maester sync` (scoped, when status returned specific behind sources) before proceeding
  - On an `up-to-date` verdict, no further user-facing prompt occurs and the read proceeds
  - On agent platforms that support hooks / pre-tool automation, the check is wired as an automated pre-read hook; on platforms that do not, the same behavior is encoded as explicit instruction the host agent is told to follow
  - The integration tolerates the absence of network access — a `failed` verdict due to no network is surfaced as informational and the read still proceeds (the agent is told to flag potential staleness in its answer)

- [x] **P0**: A standalone CLI command installs, upgrades, and adjusts the Grand Maester
  - A single CLI surface (e.g., `maester skill ...`) exposes at minimum: install (idempotent), upgrade (refresh installed artifacts to match the local `maester` version), and add-target / switch-target (install additional or different agent targets without reinstalling the rest)
  - Each subcommand is invokable from a citadel-bearing repository; running from a non-citadel directory exits with a clear error and a non-zero exit code
  - Running install when the skill is already installed for the chosen target performs an idempotent refresh (no duplication, no clobbering of user-added content in managed regions)
  - The command's help output names the supported v1 targets and points the user at the install / upgrade / add-target verbs

- [x] **P0**: Installs and upgrades are idempotent and preserve user-added content
  - Running install twice for the same target leaves the artifacts byte-identical to a single install
  - Upgrading an artifact updates only the managed region; content the user added outside the managed region is preserved
  - When an existing artifact is detected, the install / upgrade describes what it will change before writing, and confirms or proceeds based on a non-destructive default
  - No artifact is silently deleted by an install or upgrade

- [x] **P1**: Outdated installed skill is detected and an upgrade is offered
  - The standalone command can compare the installed artifacts' embedded version marker against the running `maester` version and report whether an upgrade is available
  - When an upgrade is available, the upgrade subcommand applies it to every installed target in one run
  - If no targets are installed, the command reports that clearly and exits without writing anything

- [x] **P1**: A citadel-aware helper exists for the installed integration to shell out to
  - The installed artifacts may delegate well-defined runtime queries to a `maester` subcommand instead of embedding all instruction text inline — e.g., "summarize current status as one line" or "list canon files relevant to topic X"
  - The helper's output is stable enough to be consumed by an agent without retraining (versioned output shape)
  - The helper has no side effects on the citadel destination directories or provenance markers (read-only, like [Citadel Status](citadel-status.md))

- [x] **P1**: Generic `AGENTS.md` target produces an agent-agnostic instruction file
  - The generic target writes (or updates) a single Markdown file at a conventional location in the citadel repository
  - The file's content encodes the same citadel-, state-, and freshness-awareness as the named-agent targets, in instruction-only form (no hook scripts)
  - This is the fallback any agent platform that reads project-level instructions can use without per-platform support

- [x] **P2**: User can install the Grand Maester non-interactively via flags
  - The standalone install accepts a flag-driven mode that specifies the target(s) without prompting (e.g., for CI bootstrapping or scripted setup)
  - Flag-driven install fails with a clear error and a non-zero exit code if any selected target is unknown
  - Interactive install remains the default when no flags are passed

## 5. Dependencies

- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Adds an opt-in install step to the init walkthrough. The Grand Maester does not change init's behavior when declined.
- **Citadel Status** ([citadel-status.md](citadel-status.md)) — The freshness-awareness behavior calls `maester status` and relies on its exit-code contract and (when used) `--json` output. The Grand Maester is a primary downstream consumer of status's documented interface.
- **Maester Sync** ([maester-sync.md](maester-sync.md)) — When status reports behind sources, the Grand Maester offers and orchestrates a sync. It never performs sync work directly; it only invokes the existing sync entrypoint.
- **Document State Tagging** ([document-state-tagging.md](document-state-tagging.md)) — The canon-preferring, draft-tolerant policy depends on each materialized citadel file carrying its resolved state inline. The Grand Maester instructs the host agent to read that inline state.
- **Citadel Base Directory** ([citadel-base-directory.md](citadel-base-directory.md)) — Installed artifacts reference the citadel base directory when telling the host agent where to look.

**External dependencies:**
- Each supported target agent platform (Claude Code, Codex CLI, Cursor, and any agent that reads a generic `AGENTS.md`) must be installed and runnable on the developer's machine for the installed integration to take effect. The Grand Maester installs configuration; it does not install the agents themselves.

## 6. Assumptions & Risks

**Assumptions:**
- Each named target agent in v1 (Claude Code, Codex CLI, Cursor) has a stable, documented integration surface for project-level instructions, and at least one of them (Claude Code) additionally supports hook-style runtime automation. The generic `AGENTS.md` target is a fallback for agents that read project instructions in a standard Markdown file.
- The citadel base directory and per-source layout are stable enough that instruction text can reference them by convention rather than by introspection. Layout changes that would break the instructions are handled by upgrading installed artifacts via the standalone command.
- Inline state from [Document State Tagging](document-state-tagging.md) is the primary, file-local signal an agent needs to apply the canon-over-draft policy. No external state index is required.
- The citadel repository is the right place to commit the installed artifacts — they belong to the project, not the individual developer's machine.
- The user's host agent is responsible for honoring the installed instructions; the Grand Maester does not police agent behavior, only encodes the intended behavior in the agent's native integration surface.

**Risks:**
- **Inconsistent behavior across target agents.** Different agents have different capabilities (hooks vs. instruction-only) and different interpretations of project instructions. *Mitigation:* the feature explicitly states that the runtime check is wired as a hook on platforms that support it and degrades to instructions otherwise; both modes encode the same intended behavior.
- **Stale or wrong instructions after a Maester upgrade.** The instruction text can drift from the actual behavior of `maester status` / `maester sync` if the CLI evolves and the installed artifacts are not refreshed. *Mitigation:* artifacts carry an embedded version marker; the standalone upgrade command refreshes them; the P1 "outdated installed skill" capability surfaces the gap.
- **User-edited artifacts being overwritten on upgrade.** A user who customizes the installed artifacts could lose changes when an upgrade refreshes them. *Mitigation:* artifacts carry a clearly marked managed region; upgrades touch only that region; user content outside it is preserved.
- **Freshness check fatigue.** A pre-read status hook could become annoying if it runs too often or blocks routine reads. *Mitigation:* the check uses status's documented exit-code contract (cheap, network-only) rather than running a full sync; the agent surfaces the verdict but the developer can proceed without syncing; a future "lightweight mode" is in deferred ideas.
- **Tight coupling to status's interface.** The Grand Maester depends on a stable status output and exit-code contract. *Mitigation:* status's `--json` output and exit-code semantics are spec'd as a stable interface in [Citadel Status](citadel-status.md); changes to that contract are coordinated with this feature.
- **Network failure on freshness check breaking reads.** A `failed` verdict due to no network could block agent reads if the integration is too strict. *Mitigation:* the spec explicitly says reads still proceed on `failed` and the agent is told to flag potential staleness — the check informs but does not gate.
- **Helper output drift breaking installed agents.** If the citadel-aware helper's output shape changes, agents using older installed artifacts could misread it. *Mitigation:* the helper's output is versioned; the standalone upgrade refreshes installed artifacts to match the current shape.
- **Generic `AGENTS.md` colliding with an existing user-owned file at the same path.** *Mitigation:* the install detects an existing file, uses the managed-region convention to add the Grand Maester content non-destructively, and preserves existing content outside the managed region.

## 7. Success Metrics

- After install, a host agent on a supported platform can answer citadel-relevant questions without the developer manually pointing it at the citadel base directory or explaining the canon-over-draft policy.
- On platforms with hook support, the integration runs `maester status` before substantial citadel reads in 100% of sessions where the artifacts are installed and the agent is the active runtime.
- When status reports `behind`, the host agent surfaces the verdict to the developer in the same turn rather than answering from stale content silently.
- An installed Grand Maester is upgradable in place: re-running the upgrade command refreshes the artifacts and preserves every byte of user-added content outside the managed region.
- A developer can go from "no Grand Maester installed" to "skill installed for at least one target agent" in one command (either inside citadel-init or via the standalone command).

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
