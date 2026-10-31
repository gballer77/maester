## When to use this

Use this guidance when the user asks you to set this repository up as a
maester, decide what it should publish, or review / tidy its `maester.yaml`.
`maester.yaml` is the manifest that tells consuming citadels which documents
this repository shares, plus a description, category, tags and state for each.

## Hard rules

- **Never edit `maester.yaml` by hand.** Every change goes through
  `npx baller-maester publish apply` (or `publish add | update | remove --path`),
  which validates the whole file and writes it atomically.
- **Never edit document content.** You propose manifest fields only; you do
  not add frontmatter, headers or `state:` lines to the documents themselves.
- **Write nothing until the user approves.** Present the full proposal first.
- **Never propose sensitive files** (environment files, keys, credential
  stores, `secrets/` directories). Never set `allowSensitive` unless the user
  explicitly asks to publish a specific flagged file.

## 1. Ground yourself

Run both, and base the proposal on what they return rather than guessing:

```
npx baller-maester publish list --json
npx baller-maester publish inventory --json
```

- `list` → `manifest` is `none` (no file), `whole-repository`
  (`documents: []`, everything is published) or `listed`, plus every entry.
- `inventory` → candidate documents with their size, any inline
  `state` / `category` / `tags`, which entry covers each (`coveredBy`), the
  vocabulary already in use, a per-directory rollup, and a `sensitive` list.

## 2. Draft the change set

The change set is JSON:

```json
{
  "add":    [{ "path": "docs/adr/*.md", "description": "…", "category": "adr", "tags": ["architecture"], "state": "canon" }],
  "update": [{ "path": "README.md", "set": { "description": "…" }, "unset": ["tags"] }],
  "remove": ["old/notes.md"],
  "acknowledgeNarrowing": true
}
```

- `path` is a repo-relative file or glob. Prefer one glob over listing many
  files in a uniform directory (`docs/runbooks/**/*.md`).
- `update` and `remove` refer to entries by their **exact** existing `path`.
- `acknowledgeNarrowing: true` is required when `list` reported `none` or
  `whole-repository`: today the whole repository is published, and after the
  change only the listed documents are. **Tell the user this explicitly.**

**Create mode** (`manifest` is `none` or `whole-repository`): propose a
complete set of entries covering the documentation worth sharing — READMEs,
architecture notes and ADRs, runbooks, guides, specs, API references,
changelogs. Leave out generated files, vendored content, test fixtures and
anything flagged sensitive.

**Refine mode** (`manifest` is `listed`): propose only changes, grouped as

1. **Additions** — uncovered documents (`coveredBy: null`) worth publishing.
2. **Removals** — entries that publish nothing: `npx baller-maester publish
   preview --json` flags them `empty-entry`. An entry flagged `redundant`
   only matches files an earlier entry already publishes; offer it as a
   tidy-up, but say that removing it may change those files' metadata.
3. **Fill-ins** — entries missing a description, category or tags.

Leave entries that need no change alone. Changing a field that already has a
value is a **modification**: list it separately and get explicit approval for
each one.

## 3. Validate before you show it

```
echo '<change set>' | npx baller-maester publish apply --dry-run --json
```

Add `--create` when there is no `maester.yaml` yet. A dry run writes nothing.
If it returns `{"ok": false, "error": {"field": …}}`, fix the named field and
dry-run again. Only present proposals that pass.

To show exactly which files each entry will publish, and the state /
category / tags each file ends up with, preview the change set:

```
echo '<change set>' | npx baller-maester publish preview --from - --json
```

Mention any `empty-entry` (matches nothing) or `multiMatch` (a file matched
by several entries) in the proposal.

## 4. Present the proposal

Show one table with path, description, category, tags, state and a one-line
**rationale** for every proposed entry or change, then:

- notable **exclusions** and why (generated, vendored, sensitive, …);
- the **narrowing notice** when `acknowledgeNarrowing` is set;
- every category or tag that is **new** to this repository, marked `(new)`.

Ask the user to approve, edit, or drop items. Apply their edits and dry-run
again if anything changed. If they decline, write nothing.

## 5. Write the approved changes

```
echo '<approved change set>' | npx baller-maester publish apply --json
```

(`--create` when the file does not exist yet.) Send only the items the user
approved — declined items are never written. Then show the resulting entries
from the command's output and suggest reviewing the change with `git diff`.

For a single small tweak, the flag verbs are equivalent:
`publish add --path …`, `publish update --path … [--unset field]`,
`publish remove --path …`. They take the same safety flags
(`--acknowledge-narrowing`, `--allow-sensitive`, `--dry-run`).
