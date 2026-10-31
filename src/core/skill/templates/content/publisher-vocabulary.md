## Metadata vocabulary

**Descriptions** are one line, written for someone browsing a citadel that
aggregates many repositories: say what the document is and who it helps
("Runbooks for paging incidents in the billing service"), not "Docs".

**Categories and tags** are lowercase kebab-case slugs (`api-reference`,
`runbook`). A category is the document's kind — one per entry. Tags are
cross-cutting labels — a short list.

**Reuse before you invent.** The inventory's `vocabulary` lists every category
and tag already in use (in `maester.yaml` and in the files' own inline
headers) with counts. Always prefer an existing value over a near-synonym —
use `spec` if it exists, never add `specification` beside it. Mark every value
that is new to this repository `(new)` in the proposal so the user can catch
vocabulary sprawl.

**State** tells consumers how authoritative a document is:

- `canon` — authoritative and current: READMEs, accepted ADRs, published
  specs, API references, runbooks in active use.
- `draft` — work in progress, proposals, notes, RFCs still under discussion.
- leave `state` unset ("file header") when the files already declare their
  own inline `state` (the inventory shows it), or when an entry mixes both
  kinds. Inline values in a file always win over the manifest.

Say which state you chose for each entry and why, in its rationale.
