## Connector tools (traveling maesters)

This citadel may expose one or more **traveling maesters** as MCP tools whose
names begin with the connector slug (e.g. `team_gl__list_issues`).

- Their output is **live, point-in-time data** from an external service. Cite
  specific identifiers (issue iids, ticket numbers) when surfacing it, do not
  treat it as a stable corpus, and flag the **freshness verdict** in your
  answer when it is not `up-to-date`.
- The tools' arguments and return shapes are described in MCP `tools/list`;
  do not assume undocumented fields.
- Connector tool results are JSON envelopes carrying a `dataSchema` version
  alongside the payload — if your reading of the data depends on a specific
  shape, branch on `dataSchema`.
