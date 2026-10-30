---
spec-version: v1
---

# Citadel MCP Servers

## 1. Overview

**Feature name:** Citadel MCP Servers

**Summary:** Lets a citadel declare third-party MCP servers in its configuration, alongside `sources` and `connectors`. By default the Maester MCP server (`maester mcp`) runs each declared server behind itself and exposes its tools to the agent host under a namespaced name, so every supported agent host gets the same tool surface from its single existing `maester` registration. A server can instead opt into **direct registration**, where it is written as its own entry into each supported host's MCP configuration — intended for remote servers whose authentication is a host-driven sign-in flow.

**Problem being solved:** Teams increasingly depend on third-party MCP servers (code hosts, issue trackers, databases, internal tools), but each agent host stores MCP configuration in its own file with its own shape, env-var syntax, and transport support. Every developer re-creates that setup by hand for every host they use, it drifts between machines and hosts, and credentials leak into config files. The citadel is already the committed, shared definition of a project's knowledge surface, and [Traveling Maesters](traveling-maesters.md) already registers one MCP server with every supported host. Declaring third-party servers in the citadel and serving them through that one registration makes a team's MCP setup portable across hosts, version-controlled, and secret-free.

**Delivery modes:**

| Mode | Selected by | What the host sees | Intended for |
|---|---|---|---|
| **Proxied** (default) | No `register` field, or `register: proxy` | Tools named `<server>__<tool>` under the existing `maester` entry | Local servers and remote servers using env-var token auth |
| **Direct** | `register: direct` | A separate, maester-managed entry per server | Remote servers that rely on the host's own sign-in flow |

## 2. Users & Use Cases

**Primary users:**
- AI-assisted developers who use one or more MCP-capable agent hosts and want the same third-party tools available in each
- Citadel maintainers who own the project's shared configuration and want a team's MCP setup committed once
- Developers onboarding to a project who should get the team's MCP tools by setting a few env vars, not hand-editing host configs

**Key use cases:**
1. **One declaration, every host.** A maintainer adds a code-host MCP server (a local command) to the citadel. Every developer on Claude Code, Codex CLI, or Cursor sees the same `code_host__*` tools on their next agent session, with no host-specific setup.
2. **Remote server with a token.** A maintainer adds a remote HTTP MCP server whose auth is a bearer token read from `TRACKER_TOKEN`. Developers export the variable; the proxy sends it as the authorization header. No value is written to disk.
3. **Remote server with host sign-in.** A server requires a browser-based sign-in that the agent host performs. The maintainer marks it `register: direct`; maester writes it into each host that supports remote servers, and each host runs its own sign-in.
4. **Diagnosing a broken server.** A developer's agent is missing a server's tools. They run a check command that starts each declared server, reports which ones failed and why (missing env var, command not found, connection refused), and lists the tools each one exposes.

## 3. Scope

**In-scope:**
- A new `mcpServers` list in the citadel configuration
- Two server kinds: **local** (a command plus arguments that maester starts) and **remote** (an HTTP endpoint URL)
- Credentials supplied only as env-var **names**: forwarded to local servers as environment variables, and sent to remote servers as a configured request header
- Proxied mode: `maester mcp` starts/connects to each proxied server, aggregates their tools under namespaced names, forwards tool calls and results, and shuts the servers down on exit
- Direct mode: per-host managed registration entries written by the existing per-host registration writers
- Forwarding every declared env-var name into the `maester` host registration using the existing [Connector Env-Var Seeding](connector-env-seeding.md) mechanism
- An optional step in citadel initialization, plus `add` / `remove` / `list` / `check` management commands
- Name validation shared with connectors so tool names never collide

**Out-of-scope:**
- Proxying MCP **resources** and **prompts** — v1 proxies tools only
- Host-driven sign-in flows through the proxy — servers that need them must use direct mode
- The older SSE-based remote transport
- Literal env-var values or secret values in configuration
- Maester repositories publishing MCP servers that consuming citadels inherit
- Live reload when the citadel config changes mid-session
- Installing a local server's command or its dependencies

**Deferred ideas:**
- Maester-published MCP servers inherited by citadels, with an explicit per-source trust opt-in
- Proxying resources and prompts
- SSE transport support for remote servers that have not moved to HTTP
- Non-secret literal env values for local servers
- A git-ignored, machine-local secrets file as an alternative to shell env vars
- Live reload of the proxied server set without restarting the agent session

## 4. Capabilities

- [x] **P0**: Citadel configuration accepts an `mcpServers` list
  - Each entry has a unique `name`, a kind (`local` with `command` and optional `args`, or `remote` with `url`), and optional `description`, `envVars` (names), `auth`, and `register` fields
  - `name` is unique across both `mcpServers` and `connectors`; a duplicate fails validation naming both entries
  - Names are restricted to a conservative identifier shape so derived tool names are valid on every supported host
  - A local entry with a `url`, a remote entry with a `command`, or an unknown `register` value fails validation with a message naming the entry and field

- [x] **P0**: Secrets are referenced only by env-var name
  - `envVars` lists names forwarded to a local server's environment at start time
  - A remote server's `auth` names one env var and the header it is sent in (defaulting to a bearer authorization header)
  - Every value in these fields must have the shape of an env-var name; anything else (e.g. a pasted token) fails validation without echoing the value
  - Every file maester writes contains env-var names only, never values

- [x] **P0**: `maester mcp` proxies tools from every proxied server
  - At startup the server starts each local proxied server and connects to each remote proxied server concurrently, with a bounded startup timeout per server
  - Each proxied tool is exposed as `<server>__<tool>`, normalized to the same character rules as connector tools, with the upstream description and argument schema passed through
  - A tool call is forwarded to the owning server and its result returned to the host unchanged
  - Connector tools and proxied tools appear together in one tool list

- [x] **P0**: A failing proxied server degrades only its own tools
  - A server that fails to start, connect, or list tools within the timeout contributes no tools; all other tools remain available
  - The failure reason (missing env var by name, command not found, connection refused, timeout) is logged where the host surfaces MCP server output
  - A proxied server that exits mid-session causes its tool calls to return a clear error result rather than crashing `maester mcp`
  - All proxied local servers are terminated when `maester mcp` exits

- [x] **P0**: Declared env-var names reach the proxy on every supported host
  - The `maester` host registration forwards the union of connector env-var names and `mcpServers` env-var names, using the existing per-host seeding mechanism
  - Removing a server removes its names from the managed set unless another connector or server still uses them
  - User-added entries in the host registration survive refresh, consistent with existing seeding behavior

- [x] **P1**: A server can opt into direct registration
  - `register: direct` writes a separate maester-managed entry for that server into each supported host's MCP configuration, translated to that host's format
  - A host that cannot run the server's kind is skipped with a warning naming the host and server; other hosts are still written
  - Direct servers are not started by the proxy and contribute no `<server>__` tools
  - Removing a direct server, or switching it to proxied, removes its managed entries from every host; unmanaged entries are never touched

- [x] **P1**: Users can manage servers from init and from standalone commands
  - Citadel initialization offers an optional step to declare MCP servers, after the connector step
  - `add` collects the same fields with the same validation and shows the full command or URL for confirmation before saving
  - `remove` confirms before deleting and refreshes every host registration; `list` shows each server's name, kind, mode, and env-var names
  - `add` and `remove` remind the user to restart their agent session

- [x] **P1**: A `check` command diagnoses declared servers
  - Starts or connects to each proxied server outside an agent session and reports success or failure per server with the same reason codes the proxy logs
  - On success, lists the namespaced tools each server exposes and the total tool count
  - Reports missing env-var names without printing any env-var values
  - Exits non-zero when any server fails

- [x] **P2**: A server entry can restrict which upstream tools are exposed
  - An optional allowlist of upstream tool names limits what the proxy exposes for that server
  - An allowlisted name the server does not offer produces a warning in `check` and in proxy logs
  - Omitting the allowlist exposes every tool

- [x] **P2**: Installed Grand Maester artifacts mention proxied servers
  - The connector-policy text explains that `<server>__` tools may come from third-party MCP servers declared in the citadel
  - The text does not enumerate servers or tools; MCP tool discovery remains the source of truth

## 5. Dependencies

- **Traveling Maesters** ([traveling-maesters.md](traveling-maesters.md)) — provides `maester mcp`, the per-host registration writers, the tool-naming convention, and the connector management pattern this feature extends.
- **Connector Env-Var Seeding** ([connector-env-seeding.md](connector-env-seeding.md)) — the mechanism for forwarding env-var names into each host's `maester` registration.
- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — hosts the optional MCP-server step.
- **Grand Maester Skill** ([grand-maester-skill.md](grand-maester-skill.md)) — installed policy text gains a short note (P2).

**External dependencies:**
- The Model Context Protocol client role (to talk to upstream servers) in addition to the server role already used
- Whatever runtime each local server's command requires, installed by the developer

## 6. Assumptions & Risks

**Assumptions:**
- Commands in a committed citadel config are trusted to the same degree as the project's own scripts
- Most third-party servers in use authenticate with a token or need no auth; host-driven sign-in is the minority case handled by direct mode
- Local servers can be configured through command arguments and env-var names alone
- Prefixed tool names (`<server>__<tool>`) are acceptable to agents and users

**Risks:**
- **Host tool-count limits.** All proxied tools appear under one host entry, and some hosts cap how many tools they load. *Mitigation:* `check` reports the total tool count, and the P2 allowlist trims noisy servers.
- **Slow agent startup.** Starting several servers delays the tool list. *Mitigation:* servers start concurrently with a bounded timeout; a slow server is dropped, not waited on indefinitely.
- **Arbitrary command execution from config.** A malicious change to the citadel config could run any command. *Mitigation:* the config is committed and reviewable; `add` shows the exact command before saving.
- **Lost per-server controls in hosts.** Host UIs can no longer enable or disable individual proxied servers. *Mitigation:* direct mode remains available per server; removing a server is one command.
- **Upstream protocol drift.** A third-party server uses MCP features the proxy does not pass through. *Mitigation:* tools pass schemas and results through unchanged; resources and prompts are explicitly deferred.

## 7. Success Metrics

- A server declared once in the citadel exposes an identical tool list on every supported host, with no host-specific editing by the user
- Zero secret values appear in any file maester writes, verified across citadel config and every host registration
- One failing proxied server never removes tools belonging to other servers or connectors
- A developer can go from cloning a citadel repo to calling a proxied tool by exporting the listed env vars and starting their agent — no other setup

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
