---
spec-version: v1
---

# GitLab Issues Connector

## 1. Overview

**Feature name:** GitLab Issues Connector

**Summary:** The first concrete connector type built on the [Traveling Maesters](traveling-maesters.md) framework — a read-only adapter that lets a host AI agent fetch live GitLab issue data for a configured project scope through MCP tools exposed by the `maester mcp` server. Supports **gitlab.com** and **self-hosted** GitLab instances. In v1 the connector exposes exactly two operations against the GitLab REST API as MCP tools — **list issues** with the common filter set (state, labels, assignee, milestone, search, pagination) and **get a single issue** by its project-scoped iid — returning title, description, state, labels, assignee, milestone, and timestamps. Credentials come from a personal-access-token environment variable named in the citadel config; the GitLab host URL defaults to `https://gitlab.com` and can be set explicitly for self-hosted instances. Tool results follow the framework's MCP shape (text content block carrying versioned JSON for success; tool-error response for failure). Mutations and non-issue endpoints (merge requests, comments, pipelines) are out of scope for v1.

**Problem being solved:** AI-assisted developers regularly want to ground answers in their team's actual issue tracker — "what's open against the auth module," "what does issue #482 say," "are there any P1 bugs assigned to me." Today the host agent cannot reach GitLab without the developer pasting context in by hand; even when the team's docs are mirrored into the citadel, the work tracker is not. With no concrete connector, the [Traveling Maesters](traveling-maesters.md) framework has nothing to demonstrate. The GitLab Issues connector closes both gaps: it makes the most-requested live data class first-class for the citadel, exposes it through the standard MCP tool surface the developer's agent already understands, and serves as the reference implementation that pins the framework's contracts in place.

## 2. Users & Use Cases

**Primary users:**
- AI-assisted developers whose team tracks work in GitLab issues on either gitlab.com or a self-hosted GitLab instance, using an MCP-capable agent (Claude Code, Cursor, Codex CLI)
- Citadel maintainers who want to give their team's agents read access to specific GitLab project scopes without each developer wiring it up
- Open-source maintainers whose project lives on gitlab.com and who want their agent to see open issues while answering contributor questions

**Key use cases:**
1. **List open issues for triage.** A developer asks the agent "what's open and unassigned against this repo?" The agent's host picks the connector's list-issues tool through MCP, fills in `state=opened` and an `assignee=None`-style filter, and returns a concise summary grounded in the live response.
2. **Inspect a specific issue.** A developer references "#482" in conversation. The agent invokes the connector's get-issue tool with that iid and reads the issue's title, description, state, labels, and assignee before answering.
3. **Search by label.** A developer asks "any P1 bugs open?" The agent filters by `labels=P1,bug` (or the team's equivalent) and returns the matching set.
4. **Self-hosted GitLab.** A team running GitLab Enterprise at `gitlab.acme.internal` registers a connector with that explicit host URL; the resulting MCP tool descriptions resolve to that host so the agent picks them appropriately, and everything else works identically to gitlab.com.
5. **Multiple project scopes in one citadel.** A team registers two connectors — one for their app repo, one for their infra repo — each with its own GitLab project path. The MCP server exposes parallel tool sets (`app__list_issues` and `infra__list_issues`); the agent picks the right one by name based on the developer's question.
6. **Token rotation.** A user rotates the personal access token; because the credential lives in an env var the MCP server reads at invocation time, no citadel-config change is required — the next tool call picks up the new value. (If the user rotates the env-var value while the MCP server is already running and the host has cached the parent environment, the host platform's MCP-server restart picks up the new value at the next session.)

## 3. Scope

**In-scope:**
- A connector type with the stable identifier `gitlab-issues`, registered with the [Traveling Maesters](traveling-maesters.md) type registry
- Per-connector config:
  - `host` (optional; default `https://gitlab.com`) — the GitLab base URL; HTTPS only in v1
  - `project` (required) — the project's full path on GitLab (e.g. `my-group/my-project`) or a numeric project ID
  - `apiVersion` (optional; default the GitLab REST `v4` endpoint shape this PRD targets) — reserved for forward compatibility
  - Auth: a personal access token sourced from the env-var name declared on the parent connector entry (per the framework)
- Two v1 operations against the project-scoped REST issues API, each exposed as an MCP tool by the framework:
  - **`list-issues`** — tool name `<connector_name>__list_issues`. Arguments (passed via MCP `tools/call` `arguments` object): `state` (`opened` | `closed` | `all`; default `opened`), `labels` (comma-separated label names), `assignee` (username, `None`, or `Any`), `milestone` (title or `None` / `Any`), `search` (free-text term), `page` (default `1`), `per_page` (default `20`, capped at `100` per GitLab's documented maximum)
  - **`get-issue`** — tool name `<connector_name>__get_issue`. Argument: `iid` (the project-scoped issue iid; required positive integer)
- MCP tool descriptions built dynamically from resolved config — e.g. `"List GitLab issues for project my-group/my-project on gitlab.acme.internal. Supports filtering by state, labels, assignee, milestone, and free-text search."` — so the host agent's tool-selection reasoning has unambiguous context for which connector instance to pick when multiple are configured
- MCP tool `inputSchema` (JSON Schema) generated automatically from the operation's argument definitions so the host agent knows the argument names, types, defaults, and which are required
- Tool result data shape — every issue object returned includes a stable, versioned subset of the GitLab fields most useful for agent reasoning:
  - `iid`, `id`, `title`, `description`, `state`, `labels` (string array), `assignees` (array of `{ username, name }` objects), `milestone` (nullable `{ title, state }`), `web_url`, `created_at`, `updated_at`, `closed_at` (nullable)
  - The list operation additionally returns pagination metadata (`page`, `per_page`, `total_pages`, `total` when GitLab provides them via response headers)
  - The connector's tool-result data shape carries its own `dataSchema: 1` version, distinct from the framework's protocol version, so it can evolve independently
- Error handling — every GitLab outcome maps onto the framework's MCP tool-error response shape:
  - HTTP 401 / 403 → `auth-failed`; message names the env-var (not the value) and the host
  - HTTP 404 (project or issue not found) → `remote-error` with `details.kind = not-found`
  - HTTP 429 / rate-limit-exceeded → `remote-error` with `details.kind = rate-limited` and any `Retry-After` value
  - HTTP 5xx or network/transport failure → `remote-error` with `details.kind = transport`
  - Missing env var → `missing-env-var` (handled by the framework before any network call)
  - Bad / unparseable argument → `invalid-argument` (returned by the framework / type validator before any network call)
  - Any other unexpected response shape → `remote-error` with `details.kind = unexpected` and a truncated body excerpt in `details.body`
- HTTPS-only transport in v1; TLS verification is enabled and cannot be disabled by the citadel config
- The same operations are also reachable via the framework's [P1 fallback CLI](traveling-maesters.md) (`maester connector <name> <operation>`) for non-MCP agent platforms — same per-connector code, same arguments (passed via flags rather than MCP `tools/call`), same data shape inside the success / error envelopes

**Out-of-scope:**
- Merge requests, pipelines, jobs, deployments, environments, releases, packages, snippets — issues only in v1
- Issue **comments** / notes (deferred — the issue's description is returned, but the discussion thread is not)
- Mutations of any kind — creating, updating, closing, commenting, assigning, labeling — read-only in v1
- OAuth flows; only personal access tokens (and project / group access tokens, which are interchangeable from the API surface) via env var are supported
- Webhooks, event subscriptions, real-time push — the connector's tools are pulled synchronously by the agent through MCP, not pushed to
- Cross-project search — one connector instance maps to exactly one project scope; teams that need multiple scopes register multiple connectors
- Group-scoped issue queries (deferred to a future capability; v1 is project-scoped only)
- Human-facing pretty rendering of issue data — the MCP tool result is a JSON-encoded text block consumed by the agent; humans read the agent's reformulation, not the connector's raw output
- Caching, local storage, or background prefetch of issue data — live-only, per the framework
- Federated GraphQL queries — v1 uses the GitLab REST API
- Custom field / extended attribute support beyond the documented v1 shape
- Streaming or chunked tool responses for very large result sets (the framework does not expose streaming in v1)

**Deferred ideas:**
- Issue comments (notes) as a separate operation
- Merge requests as a sibling operation set under the same type, or a new `gitlab-merge-requests` type
- Pipelines / CI status as a new type
- A `count-issues` operation that returns only the count for cheap aggregations
- Group-scoped queries (`gitlab-issues` with a group path instead of a project path)
- Cursor / keyset pagination for very large result sets
- A filter-by-iid-list operation to fetch many specific issues in one call
- Optional inclusion of additional GitLab fields (e.g. `weight`, `confidential`, `time_stats`) gated on a feature flag in the connector config
- A summary operation that wraps `list-issues` with a fixed shape (e.g. "all open issues grouped by milestone") for cheap recurring queries
- OAuth-based auth, including device-code flow for interactive setup
- Mutation operations (create, comment, close, assign, label) gated behind an explicit per-connector `write: true` opt-in
- Self-hosted GitLab with custom CA bundles for internal TLS
- An MCP "resource" view of the issue list that the agent can subscribe to and re-read on its own cadence (depends on the framework adopting MCP resources, which is a deferred framework capability)

## 4. Capabilities

- [x] **P0**: The `gitlab-issues` connector type is registered with the Traveling Maesters framework
  - The type identifier `gitlab-issues` is reserved and resolves to this connector's config validator, operation handlers, and tool-description template via the framework's compile-time type registry
  - A citadel config referencing the type loads without error when the per-type config validates; references to a typo'd type identifier fail validation with a clear, field-named error
  - Adding the type to the registry is purely additive to the framework (no changes to the MCP server's wire-protocol code or the framework's error model)

- [x] **P0**: Per-connector config accepts host, project scope, and per-type optional fields
  - `host` is optional and defaults to `https://gitlab.com`; values must be HTTPS URLs; non-HTTPS or malformed URLs fail validation at config-load time
  - `project` is required and accepts either the full URL-encoded path (e.g. `my-group/my-project`) or a numeric project ID; an empty or whitespace-only `project` fails validation
  - Validation runs at config-load time so misconfigurations surface immediately, not at first MCP tool invocation
  - The connector entry's auth env-var name is honored as the framework specifies; this PRD does not redefine the auth field

- [x] **P0**: Each configured connector exposes two MCP tools whose names are deterministically derived from the connector name
  - For a connector named `team-gl`, the framework registers MCP tools `team_gl__list_issues` and `team_gl__get_issue` (kebab-case in the connector name converted to snake_case in the tool name per the framework's tool-naming convention)
  - Each tool's `inputSchema` (JSON Schema) is generated from the operation's argument definitions and is returned by the MCP server's `tools/list` response
  - Each tool's `description` is built dynamically from the resolved config — e.g. `"List GitLab issues for project my-group/my-project on gitlab.acme.internal..."` — so the host agent has unambiguous context for tool selection
  - When the citadel-entry `description` field is set, it is prepended to the dynamic description so the maintainer can add team-specific context (e.g. `"App team's GitLab project. Use this when the user asks about the customer-facing API."`)

- [x] **P0**: The `list-issues` tool accepts the documented filter argument set
  - The tool accepts arguments (via MCP `tools/call` `arguments`): `state` (`opened` | `closed` | `all`; defaults to `opened`), `labels` (comma-separated string), `assignee` (username or `None` / `Any`), `milestone` (title or `None` / `Any`), `search` (free-text), `page` (default `1`), `per_page` (default `20`)
  - `per_page` is capped at `100` (GitLab's documented maximum); values above the cap clamp to `100` and the result's `meta` notes the clamp
  - Unknown / unsupported argument names are rejected with `invalid-argument` and the offending name in `details`
  - Argument values are passed to GitLab using the GitLab REST issues API's documented parameter names (the connector handles the mapping internally; agents always use the argument names declared in the tool's `inputSchema`)
  - The success result payload `data` field contains an array of issue objects in the v1 output shape plus pagination metadata under `data.meta`

- [x] **P0**: The `get-issue` tool fetches a single issue by project-scoped iid
  - The tool requires `iid` (positive integer)
  - A missing or non-integer `iid` fails with `invalid-argument` and a clear message
  - A successful result returns a single issue object in the v1 output shape under `data`
  - A 404 from GitLab is surfaced as `remote-error` with `details.kind = not-found` and an explicit "issue <iid> not found in project <project>" message

- [x] **P0**: Tool result data shape is stable and versioned independently of the framework envelope
  - Issue objects always include `iid`, `id`, `title`, `description`, `state`, `labels`, `assignees`, `milestone` (nullable), `web_url`, `created_at`, `updated_at`, `closed_at` (nullable)
  - `assignees` is an array of `{ username, name }` objects (empty when no assignees); the legacy single-assignee GitLab field is not surfaced separately in v1
  - `milestone` is `null` when no milestone is set; otherwise `{ title, state }`
  - The `data` payload carries `dataSchema: 1` (the per-type shape version); the version increments only on incompatible changes
  - Timestamps are ISO-8601 strings echoing what GitLab returns; no reformatting

- [x] **P0**: The connector authenticates via the env-var personal access token declared on the connector entry
  - At the moment of an MCP tool invocation, the connector reads the credential from the env var named on the connector entry and sends it as the standard GitLab `PRIVATE-TOKEN` header (or `Authorization: Bearer` form when the token type requires it)
  - When the env var is unset or empty, the framework's `missing-env-var` error response is returned before any network call (this capability inherits that behavior; it does not redefine it)
  - The credential is never logged, echoed in errors, or included in `details`; only the env-var **name** appears in error messages
  - Token rotation does not require a citadel-config change — the next tool invocation that the MCP server processes reads the env var freshly (subject to the host platform's process-environment caching; in practice the next agent-session restart guarantees rotation pickup)

- [x] **P0**: Self-hosted GitLab instances work identically to gitlab.com
  - Setting `host` to a self-hosted URL (e.g. `https://gitlab.acme.internal`) routes all API calls to that host
  - HTTPS-only transport is enforced; non-HTTPS `host` values fail validation
  - TLS verification is enabled; v1 does not expose a "skip verification" option
  - Self-hosted-specific paths or path prefixes are not assumed — the standard `/api/v4` shape is used regardless of host

- [x] **P0**: GitLab API errors map onto the framework's documented MCP tool-error responses
  - HTTP 401 / 403 → `auth-failed`; the error message names the env-var (not the value) and the host
  - HTTP 404 → `remote-error` with `details.kind = not-found`; the message distinguishes "project not found" from "issue not found" when the connector can tell the two apart
  - HTTP 429 → `remote-error` with `details.kind = rate-limited` and the GitLab `Retry-After` header value when present
  - HTTP 5xx or network/transport failure → `remote-error` with `details.kind = transport`
  - Any other unexpected response shape → `remote-error` with `details.kind = unexpected` and a truncated body excerpt in `details.body` for the agent to surface

- [x] **P0**: The framework's MCP `tools/list` is the canonical introspection surface for this connector
  - The connector type's operation handlers contribute the tool name, `description`, and `inputSchema` to the framework's `tools/list` response — no separate connector-specific introspection operation is needed
  - The introspection data does not require the auth env var and never makes a network call (it is built from the registered operation definitions plus the resolved connector config)
  - The output is stable enough for Grand Maester's policy paragraph to reference the canonical tool naming and result shape

- [x] **P1**: `list-issues` returns pagination metadata sufficient for the agent to navigate large result sets
  - The result includes `page`, `per_page`, and (when GitLab provides them via response headers) `total_pages` and `total` under `data.meta`
  - When GitLab omits the totals headers for performance reasons, the connector returns the missing fields as `null` rather than fabricating them
  - The agent can fetch subsequent pages by re-invoking with an incremented `page`

- [x] **P1**: Argument parsing produces clear `invalid-argument` errors for malformed inputs
  - A non-comma-separated `labels` value (e.g. accidental spaces or `;` separators) is rejected with a message that explains the expected form
  - A non-integer `page` or `per_page` is rejected with `invalid-argument`
  - An `assignee` or `milestone` value containing whitespace or special characters is passed through unchanged (GitLab accepts user-input names verbatim); only obviously malformed inputs (e.g. control characters) are rejected

- [x] **P1**: The connector is reachable via the framework's fallback CLI for non-MCP agent platforms
  - `maester connector <name> list-issues [--state ...] [--labels ...]` and `maester connector <name> get-issue --iid <n>` dispatch the same per-connector code as the MCP path
  - Output is JSON on stdout with the framework's fallback envelope; exit code zero on success, non-zero on failure; the `data` and `error` shapes are byte-equivalent to what the MCP tool result encodes inside its content block
  - The fallback is the path agents using the Generic `AGENTS.md` Grand Maester target use; the named MCP targets always go through MCP

- [ ] **P2**: The connector supports group-scoped issue queries
  - A new config field (e.g. `scope: "group"` with `group` instead of `project`) routes `list-issues` to GitLab's group-level issues endpoint instead of the project-level one
  - Group-scoped queries return issues across all projects in the group, with each issue object carrying its source `project_path`
  - This is deferred to v1.x and is called out as a deferred idea above; this capability is included for forward-looking visibility only

## 5. Dependencies

- **Traveling Maesters** ([traveling-maesters.md](traveling-maesters.md)) — Defines the connector framework: config schema, type registry, MCP server, tool-naming and tool-description conventions, JSON Schema input-shape generation, result/error content-block format, error-code set, env-var auth pattern, and the fallback CLI for non-MCP hosts. This PRD layers a concrete connector on top of all of that and does not redefine any of it.
- **Grand Maester Skill** ([grand-maester-skill.md](grand-maester-skill.md)) — Owns the per-target install / upgrade flow that the framework extends to register the maester MCP server and to add a connector-policy paragraph. This PRD does not interact with the skill flow directly; it is consumed through the framework.
- **Citadel Initialization** ([citadel-initialization.md](citadel-initialization.md)) — Indirectly: the connector-registration step added by the framework is the path most users take to declare a GitLab connector. This PRD does not add init capabilities of its own.

**External dependencies:**
- The **GitLab REST API** (`v4` endpoint shape) is the runtime dependency. The connector targets the documented, stable subset of the issues API and the standard `/api/v4` path prefix.
- A reachable GitLab host — either `gitlab.com` or a self-hosted instance — at the URL declared in the connector config.
- A GitLab personal access token (or equivalent project / group access token) with read scope sufficient to call the issues API for the configured project.
- The Model Context Protocol — consumed indirectly through the framework's MCP server; this PRD does not implement MCP itself.

## 6. Assumptions & Risks

**Assumptions:**
- The GitLab REST v4 issues API surface for project-scoped list and single-issue read is stable enough to target without a vendor SDK abstraction layer; the connector reads documented fields and tolerates unknown ones
- A personal access token (or equivalent) is the right credential type for the AI-assisted-developer audience; OAuth and device-code flows are not needed in v1
- Read-only is sufficient for the primary use cases; teams that want write access will wait for an explicit mutation opt-in
- Issues — not merge requests or pipelines — are the most useful first cut of GitLab data for AI agents in v1
- A single project scope per connector instance is sufficient; teams with multiple projects register multiple connectors
- MCP's `tools/call` synchronous request/response is sufficient for both operations — neither operation needs streaming or chunked delivery at v1's data volumes
- HTTPS-only transport with default TLS verification is acceptable for both gitlab.com and self-hosted setups; teams running internal CAs will need a future "custom CA" capability (deferred)
- Tool descriptions resolved from per-connector config (host + project) are specific enough that off-task invocation in non-citadel skills is unlikely; framework-level scoping mechanisms cover any residual cases

**Risks:**
- **GitLab API drift.** GitLab can change field semantics or response shapes between versions, especially on self-hosted instances running older releases. *Mitigation:* the connector targets the documented stable subset, surfaces unexpected response shapes as `remote-error` with `details.kind = unexpected`, and carries an internal `dataSchema` version that can be bumped if the breakage is incompatible.
- **Self-hosted version skew.** A self-hosted GitLab a few releases behind gitlab.com may not support every documented filter. *Mitigation:* unsupported filters surface as `remote-error` with the GitLab response body in `details`; the connector does not pretend the filter worked.
- **Token leakage through error paths.** A naive implementation could echo the token in a debug log or error message. *Mitigation:* this PRD explicitly requires that the token never appears in any output field; only the env-var name is ever surfaced.
- **Rate-limit churn.** An agent that loops on `list-issues` (e.g. fetching every page) could trip GitLab's rate limits. *Mitigation:* the rate-limit response is surfaced with `Retry-After` in `details`; the agent is expected to back off; the framework explicitly defers retry policy to the agent.
- **Large issue descriptions blowing context budgets.** A single issue with a long description (thousands of lines) returned through `get-issue` could overwhelm the host agent's context. *Mitigation:* v1 returns the description unmodified to preserve fidelity; agents already handle context budgeting and can summarize; a future capability may add an optional description-truncation flag.
- **Confidential issues.** A token with broad access could return confidential issues that the developer's broader audience should not see. *Mitigation:* this is a token-scope concern, not a connector concern — teams scope their tokens appropriately. The output shape does not currently surface a `confidential` flag; if that becomes important it joins the optional-fields deferred idea.
- **Self-hosted instance with invalid / private CA.** Internal CA chains may not validate with the default system trust store. *Mitigation:* v1 enforces TLS verification and surfaces failures as `remote-error` with `details.kind = transport`; the "custom CA bundle" capability is explicitly deferred so the security posture stays predictable in v1.
- **Project-path vs. project-ID ambiguity.** A configured `project` value that happens to be both a numeric string and a valid path could be misinterpreted. *Mitigation:* the connector treats purely-numeric values as project IDs and everything else as URL-encoded paths; config validation surfaces the resolved interpretation in any error message.
- **Read-only assumption could surprise users.** A user expecting to close issues via the connector finds it cannot. *Mitigation:* the MCP tool descriptions and the Grand Maester policy paragraph label connector operations as read-only in v1; mutation is a deferred capability with a clear opt-in shape.
- **GitLab.com network unreachable from the developer's environment.** *Mitigation:* the connector surfaces `remote-error` with `details.kind = transport`; the agent informs the developer; this is consistent with how the Grand Maester freshness check already handles network-loss states.
- **Cross-host MCP tool-name normalization.** Some MCP host platforms may restrict tool-name characters more aggressively than others; the framework normalizes hyphens to underscores to maximize compatibility, but a future host could narrow the surface further. *Mitigation:* the framework's tool-name format is conservative and reserved characters are documented; if a host requires further normalization, the framework adapts centrally rather than per type.

## 7. Success Metrics

- A host agent on a Grand Maester-installed citadel with a configured GitLab connector can answer "what issues are open against <project>?" using live data, without the developer pasting issue content
- Every GitLab API response (success, 401, 404, 429, 5xx, network failure) maps onto a documented framework MCP tool response shape — no path produces unparsable or ambiguous output
- Zero secret values are written to disk by the connector or any of its operations across all supported flows
- A team can go from "no GitLab connector configured" to "agent successfully invoking `<name>__list_issues` via MCP" in one walkthrough plus a single env-var export and one agent-session restart — no manual edits to citadel.yaml or any MCP config file required
- The connector's tool result shape is stable across GitLab releases for fields it documents — a GitLab update that adds new fields does not break agents already consuming the documented subset

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
