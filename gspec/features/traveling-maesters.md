---
spec-version: v1
---

# Traveling Maesters

## 1. Overview

**Feature name:** Traveling Maesters

**Summary:** A new kind of citadel entry — called a **connector** in the citadel configuration — that lets an AI agent fetch live, on-demand data from an external service (issue trackers, chat, ticket queues) through the **Model Context Protocol (MCP)**. The Maester package ships an MCP server, exposed as a CLI verb (`maester mcp`), that reads each repository's citadel configuration at startup, instantiates every configured connector, and registers each connector operation as an MCP tool with the agent host. Unlike a citadel **source**, which mirrors static content into the citadel destination via [Maester Sync](maester-sync.md), a traveling maester writes nothing to disk: each tool invocation hits the remote service live and returns its result to the agent through MCP. This PRD defines the connector framework itself — config schema, MCP server lifecycle, per-host registration, type registry, tool-naming convention, auth pattern, error model, and integration with [Grand Maester Skill](grand-maester-skill.md) — not any particular connector implementation. Specific connector types (e.g. [GitLab Issues Connector](gitlab-issues-connector.md)) are layered on top.

**Problem being solved:** A citadel today is excellent for content that benefits from being mirrored as files — docs, playbooks, specs, conventions. But a great deal of knowledge that AI-assisted developers actually want to reason about lives in systems where mirroring is the wrong shape: issue trackers change every minute, chat scrollback is unbounded, ticket queues are filtered views rather than file sets. Forcing that data through the sync pipeline would be slow, stale, and storage-heavy. At the same time, every modern coding agent — Claude Code, Cursor, Codex CLI — has converged on **MCP** as the standard protocol for connecting agents to live data sources, and every host platform already knows how to discover and invoke MCP tools. Today the host agent has no first-class way to reach external systems *through the citadel*; developers paste excerpts manually, or the agent gives up. Traveling maesters give the citadel a second mode — a registered, named, auth-aware MCP tool surface — that hooks into the agent host the user already uses, with the same configuration-as-code posture the citadel already has for sources.

## 2. Users & Use Cases

**Primary users:**
- AI-assisted developers running an MCP-capable coding agent (Claude Code, Cursor, Codex CLI) who want their agent to answer questions grounded in live data from external systems
- Citadel maintainers who want to declare, in committed config, which external systems their team's agents can reach — without each developer hand-configuring MCP for themselves
- Connector implementers (Maester contributors and, eventually, third parties) adding new connector types under a consistent framework that produces consistent MCP tool surfaces

**Key use cases:**
1. **Register a connector during citadel init.** A developer initializing a citadel adds a connector (e.g. their team's GitLab project) in the walkthrough, naming the env var that holds the access token. Init writes the connector entry into the citadel config *and* writes/updates the MCP server registration in each supported agent host's project-level MCP config.
2. **Agent invokes a connector tool over MCP.** When the developer's next agent session starts, the host platform reads its MCP config, spawns the `maester mcp` server, discovers the configured connectors' tools via MCP `tools/list`, and invokes them via `tools/call` when the developer asks a relevant question. No custom CLI shell-out is involved.
3. **Multiple connectors, one MCP server.** A citadel with several connectors — a GitLab project, a separate GitLab group, possibly a future Linear or Jira connector — is exposed as a single `maester mcp` server process whose tools are namespaced by connector name (e.g. `team_gl__list_issues`, `vendor_linear__list_issues`). The agent picks the right tool by name based on the developer's question and the tool's description.
4. **Grand Maester adds policy, not enumeration.** The [Grand Maester Skill](grand-maester-skill.md) installer registers the maester MCP server in each target's MCP config (so the tools surface in the next session) and adds a short policy paragraph to its installed artifacts about how to reason over connector tool output — live data, cite specifics, watch the freshness verdict — but it does **not** enumerate the configured connectors, because MCP discovery handles that automatically.
5. **Add or remove a connector after init.** A user runs a standalone command to add, remove, or list connectors. The command updates the citadel config and refreshes the MCP registrations across every installed agent host. The user restarts their agent session to pick up the new tool surface (most host platforms restart the MCP server automatically when its config changes).
6. **Tools are tools, not skill-scoped.** Once the MCP server is registered, every skill / context in the agent session inherits access to the configured connectors' tools. The Grand Maester skill steers reasoning around them with policy text; it does not — and cannot — hide them from other contexts. Tool descriptions are narrow and project-specific so off-task invocation is unlikely in practice.
7. **Fallback for non-MCP agents.** Agents that read project-level instructions but cannot speak MCP (the generic `AGENTS.md` target) get a fallback agent-shaped CLI surface (`maester connector <name> <operation> [...args]`) documented in their installed instructions. The fallback shares its implementation with the MCP server — same per-connector code, same operations — but does one process per call instead of a long-lived server.

## 3. Scope

**In-scope:**
- A new `connectors` array in the citadel configuration, sibling to `sources`, where each entry declares:
  - A short unique `name` (used to namespace MCP tool names and to identify the entry in agent instructions)
  - A `type` (the connector kind, e.g. `gitlab-issues`)
  - An auth reference — the **name** of an environment variable expected to hold the credential (never the credential itself)
  - A `description` (optional) that is surfaced into the MCP tool descriptions for this connector
  - A per-type `config` object whose shape is owned by the specific connector type's PRD
- A `maester mcp` CLI subcommand that runs a **stdio-based MCP server** for the current repository:
  - Reads `citadel.yaml` at startup
  - Instantiates every configured connector using its registered type's handler
  - Registers each connector's operations as MCP tools with namespaced names (`<connector_name>__<operation_name>`, with kebab-case parts converted to snake_case where needed for MCP tool-name compatibility)
  - Builds each tool's `description` dynamically from the connector's `description` (when set) plus the resolved per-type scope (e.g. "List issues from gitlab.acme.internal/team/project")
  - Serves `tools/list` and `tools/call` requests in the documented MCP shape
  - Exits cleanly when its stdio peer closes
- A connector-type registry (compile-time): each registered type has a stable identifier, an owned config schema, an owned operation set, and a tool-description template
- A documented MCP tool result and error format:
  - Success: a single `text` content block whose body is JSON-encoded per the operation's data shape; per-type `data` shape versions are independent of the framework's protocol version
  - Failure: an MCP tool error response (`isError: true`) with a single `text` content block containing a JSON-encoded error object — `code` drawn from a small documented set (`missing-env-var`, `connector-not-found`, `unknown-operation`, `auth-failed`, `remote-error`, `invalid-argument`, plus a fallback `internal-error`), `message`, and an optional `details` object
  - The error-code set is treated as a stable interface; additions are additive and versioned
- An operation-introspection facility:
  - The MCP `tools/list` response itself is the canonical introspection surface — the agent host already enumerates every tool, its arguments, and its description through this protocol primitive
  - Each tool's `inputSchema` is a JSON Schema describing its argument shape, generated from the connector type's operation definition
- Auth handling:
  - Each connector references its credential by environment-variable **name** only
  - The MCP server reads `process.env[entry.auth.envVar]` lazily, at the moment a tool is invoked
  - Missing/empty env vars produce a `missing-env-var` tool error without making any network call
  - Credential values are never logged and never appear in any output field — only the env-var name is ever surfaced
  - Same heuristic used for source-side auth (warn — do not accept — when the entered value looks like a token rather than an env-var name) is applied at every entry point that accepts the field
- Validation of connector entries at every entry point (citadel config load, init walkthrough, standalone management command):
  - `name` must be unique across all connectors (and is namespaced separately from `sources` — a source and a connector may share a name without collision, though doing so is discouraged)
  - `type` must reference a registered connector type
- MCP server registration writers — one per supported agent host — that write/update the host's project-level MCP configuration to register `maester mcp`:
  - The set of supported hosts is aligned with the [Grand Maester Skill](grand-maester-skill.md) named-skill targets (Claude Code, Codex CLI, Cursor)
  - Each host has its own documented file path and entry shape; the framework owns one writer per host
  - Writers use a managed-region convention so user content outside the maester entry is preserved
  - Writers are idempotent — running registration twice produces byte-identical files
- Optional registration step during citadel initialization (delegated from [Citadel Initialization](citadel-initialization.md)) so connectors can be declared in the same walkthrough that registers sources, and the chosen MCP-capable hosts are configured in one pass
- A standalone management surface for connector add / remove / list after init:
  - `add` reuses the same prompts and validation as the init-walkthrough step; refreshes MCP registrations for every installed host
  - `remove` requires the target connector name and confirms before deleting the entry; refreshes MCP registrations
  - `list` prints the configured connectors in a stable shape that a human can read directly
- Integration with [Grand Maester Skill](grand-maester-skill.md):
  - When the skill is installed (or upgraded) on an MCP-capable target, the skill installer also writes the maester MCP server registration into that target's MCP config
  - When the skill is upgraded, the registration is refreshed alongside the skill artifacts
  - The skill's installed artifacts add a short, fixed policy paragraph about reasoning over connector tool output (live data; cite specific item identifiers; flag staleness when relevant; treat output as point-in-time)
  - The installed artifacts deliberately do **not** enumerate configured connectors — MCP discovery is the source of truth for what tools are available
- A fallback agent-shaped CLI surface (`maester connector <name> <operation> [--key value]...`) for agents that cannot speak MCP:
  - One process per call, exits when the call completes
  - Output: JSON on stdout with a versioned envelope containing the same `data` (success) or `error` (failure) shape the MCP server returns inside its content blocks
  - Exit code zero on success, non-zero on failure
  - Same connector code and the same per-type operation set as the MCP server — the surfaces are two front-ends over one implementation
  - Documented in the generic `AGENTS.md` target's installed artifact as the way to invoke connectors for hosts without MCP
- Read-only posture in v1 — connectors fetch and surface data but do not mutate the remote service

**Out-of-scope:**
- HTTP-based MCP servers — only stdio in v1 (decided during PRD intake)
- MCP resources or MCP prompts — only tools in v1
- Streaming or chunked tool responses — synchronous request/response only
- Tool-call authentication at the MCP protocol layer — the agent host is trusted by virtue of running on the developer's machine; each tool authenticates separately to its backing service via the env-var credential
- Any caching, snapshotting, or local mirroring of connector output — traveling maesters are live-only by design (decided during PRD intake)
- Connectors that mutate remote state (writes, comments, status changes) — read-only in v1
- A specific connector implementation — those are owned by per-type PRDs (e.g. [GitLab Issues Connector](gitlab-issues-connector.md))
- A general-purpose plugin marketplace or runtime loader for third-party connector types — v1 supports only types shipped in the `maester` package
- Live config reload: the MCP server reads `citadel.yaml` at startup; mid-session connector changes require the host platform to restart the server (most host platforms restart MCP servers automatically when their config file changes)
- Per-connector rate-limit policies, retry budgets, or circuit breakers — connectors surface the remote's response unchanged and let the host agent decide
- Cross-connector composition (e.g. "fetch issues, then their linked merge requests") — the agent orchestrates; the framework provides primitives
- Persisting any session state between server lifetimes (no on-disk token caches, no cookies)
- Hard scoping that hides connector tools from particular skills or contexts — MCP does not expose a per-skill tool-gating mechanism; framework-level steering is via tool descriptions and Grand Maester policy text
- Human-facing CLI ergonomics around connector output (paging, color, table rendering); the fallback CLI's output is agent-shaped JSON only

**Deferred ideas:**
- HTTP-based MCP servers for shared / remote-hosted deployment
- A write-capable mode for connectors (e.g. closing issues, posting comments) with explicit per-operation opt-in and per-tool authorization
- A plugin loader so third-party connector types can be installed alongside the shipped ones
- MCP resources for browsable connector data (e.g. exposing the issue list as a resource the agent can subscribe to)
- A summary / digest operation common to all connectors layered over per-type primitives
- Caching of connector results with explicit TTLs for expensive queries
- Streaming pagination for very large result sets (using MCP's progress / chunking conventions when they stabilize)
- Live `citadel.yaml` reload while the MCP server is running
- Telemetry of which connector tools the agent invokes and how often
- A connector-aware freshness signal (similar to `maester status`) so the agent can know when a remote service is unreachable before invoking it
- Connector-scoped audit logs of every invocation written into the citadel for review
- Promoting the fallback CLI surface to a primary, human-friendly developer tool for ad-hoc use
- Honoring `MCP_*` host-provided context (e.g. caller identity) once MCP standardizes such conventions

## 4. Capabilities

- [ ] **P0**: Citadel configuration declares a `connectors` array sibling to `sources`
  - The citadel config schema accepts an optional `connectors` array; an empty or omitted array is valid and means "no connectors"
  - Each entry carries at minimum `name`, `type`, and an auth reference; entries may carry an optional `description` and a `config` object whose shape is owned by the per-type PRD
  - The config file's schema/version marker leaves room to evolve the `connectors` shape in later spec versions without breaking v1 consumers
  - Loading a citadel with connectors does not change the behavior of `maester sync` — sync operates over `sources` only

- [ ] **P0**: Each connector references its auth credential by environment-variable name only
  - The auth field stores the **name** of an environment variable expected to hold the credential at MCP-tool-invocation time, mirroring the source-side auth pattern from [Citadel Initialization](citadel-initialization.md)
  - No secret value is ever written to the citadel config by the framework or by the init / management walkthroughs
  - The same heuristic used for source-side auth — warn (do not accept) when the entered value looks like a token rather than an env-var name — is applied at every entry point that accepts the field
  - The committed citadel config is safe to share publicly even when private connectors are configured

- [ ] **P0**: A `maester mcp` CLI subcommand runs a stdio-based MCP server for the current repository
  - Invoked from a citadel-bearing directory, `maester mcp` starts an MCP server that speaks the MCP wire protocol over stdio (JSON-RPC frames on stdin/stdout)
  - The server reads `citadel.yaml` once at startup; an empty or missing `connectors` list yields an empty tool surface and the server still runs cleanly
  - The server exits cleanly when its stdio peer closes the channel; it never writes uninvited output to stdout that could corrupt the JSON-RPC stream (all diagnostics go to stderr)
  - Invoked from outside a citadel-bearing directory, the server exits non-zero with a clear stderr message
  - The server is launched by the host agent platform (Claude Code, Cursor, Codex CLI) per the MCP registrations the framework writes — not typically invoked directly by humans

- [ ] **P0**: The MCP server exposes one tool per configured (connector, operation) pair with a deterministic naming convention
  - Tool name format: `<connector_name>__<operation_name>` with hyphens in either side converted to underscores for cross-host compatibility
  - Two different connectors of the same type produce two parallel sets of tools (e.g. `team_gl__list_issues` and `vendor_gl__list_issues`)
  - Each tool's `inputSchema` is a JSON Schema describing the operation's arguments — names, types, defaults, required vs. optional
  - Each tool's `description` is built dynamically from the connector entry's `description` (when set) plus the resolved per-type scope (e.g. "List issues from gitlab.acme.internal/team/project") so the agent can pick the right tool without re-asking the user
  - Tool descriptions are narrow and project-specific enough that off-task invocation is unlikely in practice (the framework relies on this as the primary scoping mechanism — see Use Case 6)

- [ ] **P0**: Connector tool results follow a documented, machine-readable shape
  - Success: a single `text` content block whose body is JSON-encoded per the operation's data shape; the JSON includes a per-type `dataSchema` version field so the agent can decode future shape evolutions
  - Failure: an MCP tool error response (`isError: true`) with a single `text` content block containing a JSON-encoded error object — `code` drawn from a documented set, `message`, optional `details`
  - The success and failure shapes share a top-level schema version so a single decoder reads either
  - The framework-level error-code set is bounded and stable: `missing-env-var`, `connector-not-found`, `unknown-operation`, `auth-failed`, `remote-error`, `invalid-argument`, `internal-error`
  - Per-type errors that do not fit a framework code map to `remote-error` with the per-type detail in the `details` field

- [ ] **P0**: Connector types are first-class and validated at config-load time
  - The framework maintains a compile-time registry of supported connector types; each entry maps a type identifier to a config-schema validator and an operation handler set
  - Loading a citadel config that references an unknown `type` fails validation with a clear, field-named error pointing at the offending entry
  - The validator for a registered type rejects malformed per-type config at config-load time, not at first MCP-tool invocation
  - Adding a new connector type is purely additive to the registry and does not require changes to the MCP server's wire protocol or the framework's error model

- [ ] **P0**: Missing or empty auth env var produces a clear, dedicated error inside the MCP response
  - When a tool invocation needs the auth credential and the named env var is unset or empty at the moment of the call, the MCP server returns the `missing-env-var` error response naming the variable that is missing
  - The error never echoes the variable's value (even partially) — only its name
  - Tools that legitimately do not need credentials succeed without the env var being set
  - The check happens before any network call so missing-credential failures are fast and free

- [ ] **P0**: MCP server registrations are written into each supported host platform's project-level MCP config
  - Per-host writers exist for at least: **Claude Code**, **Codex CLI**, and **Cursor** (the same three named-skill targets carried by [Grand Maester Skill](grand-maester-skill.md))
  - Each writer knows its host's documented file path and entry shape and writes a managed `maester` entry that points at `maester mcp` (or the equivalent invocation form, e.g. `npx maester mcp`)
  - Writers use a managed-region convention so user-authored MCP entries outside the maester block are preserved
  - Writers are idempotent — running registration twice produces byte-identical files
  - The Generic `AGENTS.md` target is **not** an MCP target (no MCP config to write); its installed artifact instead documents the fallback CLI surface (see the fallback-CLI capability below)

- [ ] **P0**: Connectors can be registered during citadel initialization
  - The [Citadel Initialization](citadel-initialization.md) walkthrough offers an optional step to register one or more connectors, alongside the existing source-registration step
  - For each connector, the walkthrough collects the connector type, a unique name, the auth env-var name (when required), an optional description, and any per-type config the connector's PRD declares as required
  - The walkthrough rejects an unknown connector type and rejects a name that collides with an existing connector before continuing
  - When connectors are registered AND the user has accepted (or already installed) the Grand Maester skill for one or more MCP-capable targets, init writes the MCP server registration into those targets in the same pass
  - Skipping the connector step completes init normally with an empty `connectors` array and zero MCP registrations

- [ ] **P0**: Grand Maester skill install/upgrade refreshes MCP server registrations and adds a connector-policy paragraph
  - When the Grand Maester skill is installed (or upgraded) on an MCP-capable target in a citadel that has any connectors configured, the install also writes the maester MCP server registration into that target's MCP config
  - The skill's installed artifacts include a short, fixed policy paragraph about reasoning over connector tool output: live data, cite specifics, watch staleness verdict, treat output as point-in-time
  - The skill's installed artifacts deliberately do **not** enumerate configured connectors — MCP discovery is the source of truth for what tools are available
  - The policy paragraph lives inside the managed region of the installed artifacts so user-added content is preserved on refresh
  - When no connectors are configured in the citadel, the MCP registration is still written (so the agent picks up future additions automatically); when no connectors are configured AND no MCP-capable targets are installed, no MCP-config files are written
  - The Generic `AGENTS.md` target additionally documents the fallback CLI surface in its installed artifact (see the fallback-CLI capability below)

- [ ] **P0**: A standalone management surface adds, removes, and lists connectors after init and refreshes MCP registrations
  - A CLI verb group (e.g. `maester connector add / remove / list`) operates on the citadel's existing config without re-running init
  - `add` reuses the same prompts and validation as the init-walkthrough step and refreshes MCP registrations for every installed MCP-capable target afterward
  - `remove` requires the target connector name, confirms before deleting the entry, and refreshes MCP registrations afterward
  - `list` prints the configured connectors in a stable shape that a human can read directly
  - Running any verb outside a citadel-bearing directory exits with a clear error and a non-zero exit code
  - `add` / `remove` report to the user that they should restart their agent session to pick up the tool-surface change (host platforms typically restart MCP servers automatically when config changes, but the user-visible reminder makes it unambiguous)

- [ ] **P1**: A fallback agent-shaped CLI surface (`maester connector <name> <operation> [...args]`) exists for non-MCP agent platforms
  - The verb dispatches the same per-connector code as the MCP server; one process per call
  - Output is JSON on stdout with a versioned envelope containing the same `data` (success) or `error` (failure) shape the MCP server returns inside its content blocks; exit code zero on success, non-zero on failure
  - Invoking an unknown connector name, an unknown operation, or a malformed argument returns the same framework error-code set used by the MCP path
  - The fallback is documented in the Generic `AGENTS.md` target's installed artifact as the way to invoke connectors for hosts that cannot speak MCP
  - The fallback is **not** the primary surface for any of the named MCP targets; their installed artifacts point at MCP tools, not at the fallback

- [ ] **P1**: A non-interactive flag mode supports scripted connector registration
  - The standalone `add` verb accepts a flag-driven form (e.g. `--type <type> --name <name> --env-var <NAME> --config <inline-json>`) that bypasses prompts
  - Flag-driven add fails with a clear error and a non-zero exit code on validation failure
  - Interactive add remains the default when no flags are passed

- [ ] **P1**: The MCP server validates the configured citadel.yaml at startup and surfaces validation failures cleanly
  - A malformed `citadel.yaml`, a connector entry that references an unknown `type`, or a per-type config that fails its validator causes the server to exit non-zero with a clear stderr error before any MCP frames are exchanged
  - The host platform surfaces the error to the developer (most platforms log the spawn failure) so the developer can fix the config and restart
  - Partial successes are **not** allowed — the server either exposes the full validated set of tools or it does not start

- [ ] **P2**: Connector names that collide with existing source names warn (do not reject)
  - The management commands warn — do not reject — when a connector name shadows a source name, since the two live in separate namespaces but reading the config can confuse a future maintainer
  - The warning is informational; the entry is still added

- [ ] **P2**: A diagnostic verb reports the resolved tool surface without starting an MCP session
  - A verb (e.g. `maester connector tools`) prints the names, descriptions, and argument shapes of every tool the MCP server *would* expose for the current citadel config
  - Useful for spec authors verifying tool naming and descriptions before committing a citadel-config change
  - Output is the same shape an MCP `tools/list` response would carry; humans can read it but it is primarily a debugging surface

## 5. Dependencies

- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Hosts the optional connector-registration step inside the init walkthrough and, when MCP-capable Grand Maester targets are also being installed, the MCP-config writes that go with them. The walkthrough collects connector entries and writes them into the same citadel config it produces today, alongside the `sources` list.
- **Grand Maester Skill** ([grand-maester-skill.md](grand-maester-skill.md)) — Owns the per-target install/upgrade flow. This feature extends those flows so that, on each MCP-capable target, the installer also writes the maester MCP server registration and the installed artifacts gain a connector-policy paragraph. The skill does not enumerate connectors — MCP discovery is the source of truth.
- **Maester Configuration** ([maester-configuration.md](maester-configuration.md)) — Independent of this feature; connectors live entirely in the citadel config and do not flow through a remote `maester.yaml` manifest. Listed for context only.
- **Maester Sync** ([maester-sync.md](maester-sync.md)) — Explicitly **not** a dependency. Connectors do not participate in sync; the two systems are deliberately separate.

**External dependencies:**
- The Model Context Protocol specification — the wire protocol the MCP server implements and that supported agent hosts (Claude Code, Cursor, Codex CLI) already consume
- A reasonably current build of each supported agent host that includes MCP client support
- The host process must expose environment variables to the spawned MCP server (standard for any host-spawned subprocess)
- Each connector type's PRD may add its own external dependencies (e.g. the GitLab API for `gitlab-issues`); the framework itself adds none beyond MCP

## 6. Assumptions & Risks

**Assumptions:**
- MCP is the right protocol for the agent-facing surface in v1 — the three named target agents (Claude Code, Codex CLI, Cursor) already support MCP as their primary live-tool integration path, and a custom dispatch protocol would duplicate work the ecosystem has already solved
- Stdio-based MCP servers cover v1's needs; HTTP-based MCP for remote-hosted deployment is a deferred capability
- A single long-lived MCP server per repository session is the right granularity — one process holds the citadel config, instantiates every connector once, and serves all tool calls for the session
- Tool discovery is sufficient as the only enumeration mechanism — agents and host platforms already enumerate MCP tools at session start; an additional bespoke enumeration in installed agent artifacts would be redundant
- Tool descriptions, written narrowly and project-specifically (resolved host + project path), are sufficient as the primary scoping mechanism; hard per-skill gating is not available in MCP and is not pursued
- Live, on-demand fetching is the right shape for the data classes traveling maesters cover (issue trackers, chat, ticket queues); systems whose data benefits from mirroring belong in `sources`, not `connectors`
- The env-var auth pattern already used by `sources` is the right pattern here; developers will not be surprised by it and ops practice already supports it
- The citadel config is a trusted, repo-committed artifact; its connector declarations do not need to be defended against tampering by other developers
- Read-only is sufficient for v1 — agents most often want to ground answers in remote data, not change it; write operations are a deliberate later addition

**Risks:**
- **MCP protocol drift.** MCP is young; the wire protocol may evolve in incompatible ways. *Mitigation:* the framework targets a documented version of MCP; the per-type `data` shape inside tool responses carries its own version independent of MCP; the framework can bump its MCP version with a major package release.
- **Cross-host MCP quirks.** Different host platforms (Claude Code, Cursor, Codex CLI) may interpret tool-name characters, argument-schema features, or content-block types slightly differently. *Mitigation:* the framework restricts tool names to a conservative `[a-z0-9_]+` shape, uses simple JSON Schema features in `inputSchema`, and returns one `text` content block per tool result for maximum compatibility.
- **Token leakage via misconfiguration.** A user could paste a raw token into the auth field by mistake. *Mitigation:* re-use the same name-vs-value heuristic and prompt copy already established for source-side auth in [Citadel Initialization](citadel-initialization.md); never echo the env var's value in errors.
- **Cross-skill tool visibility.** Once the MCP server is registered, every skill / context in the agent session sees the connector tools. *Mitigation:* tool descriptions are narrow and project-specific; the Grand Maester skill adds a policy paragraph that the agent honors as instruction. Hard gating is unavailable in MCP and is documented as out-of-scope.
- **Stale tool surface after a config edit.** A user adds a connector but the host agent does not restart its MCP server, so the new tool is not visible until the next session. *Mitigation:* the management commands explicitly remind the user to restart their agent; host platforms typically restart MCP servers automatically when their config file changes; live config reload is deferred but a clear future capability.
- **Network failure mid-operation.** A connector cannot reach the remote service. *Mitigation:* the framework's error model includes `remote-error` and `auth-failed` codes so the agent can distinguish "service down" from "you used the wrong token"; agents can decide their own retry policy.
- **Operation-name collisions across types.** Two types may both expose `list` or `get` with different argument shapes. *Mitigation:* every tool name is prefixed with the connector instance's `<name>__`, and the framework's tool-name format guarantees uniqueness within a citadel because connector names are unique.
- **Hidden cost of large remote responses.** A connector tool could return a very large payload that overwhelms the agent's context. *Mitigation:* per-type PRDs are expected to spec pagination / per-page caps in their operations (see [GitLab Issues Connector](gitlab-issues-connector.md)); the framework does not impose a global cap.
- **MCP-server crash kills the tool surface for a session.** *Mitigation:* host platforms supervise MCP servers and restart them automatically; the framework keeps the server simple, validates config at startup so crashes are caught early, and returns errors (not exceptions) from individual tool calls.
- **Fallback CLI confusion.** Developers might invoke the fallback CLI directly and assume it is the primary surface. *Mitigation:* the fallback is framed as such in its help text and in the Generic `AGENTS.md` installed artifact; the named MCP targets' installed artifacts never reference it.

## 7. Success Metrics

- A host agent on a Grand Maester-installed citadel can discover every configured connector through standard MCP tool discovery — no developer instruction, no manual enumeration in installed artifacts
- A connector tool invocation returns either a documented `data` payload (success) or a documented error response (failure) in 100% of runs — there is no path that produces unparsable output
- Zero secret values are written to disk by the connector framework or any of its prompts across all supported auth flows
- A developer can go from "no connector configured" to "agent successfully invoking the connector via MCP" in one walkthrough plus a single env-var export and one agent-session restart — no manual editing of the citadel config or MCP config files required
- Adding a new connector type is a purely additive change to the registry and does not require modifying the MCP server's wire-protocol code, any per-host MCP registration writer, or the Grand Maester install flow

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
