---
spec-version: v1
---

# Config JSON Schemas

## 1. Overview

**Feature name:** Config JSON Schemas

**Summary:** Publish a machine-readable JSON Schema for both configuration files (the maester manifest and the citadel configuration). Every file the tool generates is linked to its schema, so editors validate and autocomplete it without the tool installed.

**Problem being solved:**
- Today the only way to write a valid maester manifest is to install and run the tool. That's a real barrier for repositories whose teams don't use its runtime, and for owners who just want to add one small file.
- Hand-authored manifests fail only at the next citadel sync, which is far from the author and often run by someone else.
- Editors already know how to validate YAML against a schema and offer field help, but the tool doesn't publish one.

## 2. Users & Use Cases

**Primary users:**
- Repository owners adding a maester manifest by hand, often in a repository with no connection to the tool's runtime
- Citadel maintainers editing their configuration directly
- Coding agents that write configuration and rely on editor diagnostics or schema-aware tooling

**Key use cases:**
1. **Hand-author without installing.** A service owner copies a three-line manifest from the docs into their repository. Their editor immediately autocompletes `state`, lists the allowed values, and underlines a tag written in camelCase.
2. **Catch mistakes at authoring time.** A maintainer types `stat: canon` in the citadel configuration's `includes` entry. The editor flags the unknown key before the change is committed.
3. **Field help in place.** Hovering over `excludes` shows what it does, and that it applies only to whole-repository sources.
4. **Generated files are self-describing.** A manifest the walkthrough or the invite flow produces opens in any schema-aware editor with validation already on, with no editor configuration needed.

## 3. Scope

**In-scope goals:**
- One JSON Schema per configuration file, generated from the same definition the tool uses for runtime validation.
- Schemas shipped inside the published package at stable paths, so any public package CDN can serve them at a version-ranged URL.
- A schema-association comment header written into every configuration file the tool creates.
- A way to add that header to existing configuration files.
- Documentation on hand-authoring a manifest without installing anything.
- A submission to the public schema catalog that editors use to associate schemas by file name.

**Out-of-scope:**
- Making the schema the authority on validity. Runtime validation stays authoritative: cross-field rules such as duplicate paths or the last-entry guard aren't expressed in the schema.
- Hosting the schema on a dedicated domain or website.
- Editor plugins or extensions.
- Changes to the configuration format itself.

**Deferred ideas:**
- A standalone validate command that checks a file against the schema without a full config load.
- Schemas for the tool's machine-readable command outputs (list, inventory, preview, change sets).

## 4. Capabilities

- [ ] **P0**: Each configuration file has a JSON Schema generated from the runtime validation definition
  - A schema exists for the maester manifest and one for the citadel configuration. Both are produced by the build from the same definitions the tool validates with. There's no hand-maintained copy.
  - The schemas encode allowed keys, required fields, enumerations (state values, source modes, auth types), and slug and path patterns wherever the runtime definition expresses them.
  - An automated check fails if a committed or shipped schema differs from what the current definitions generate.
  - Every sample configuration in the project's tests and docs validates against its schema.
- [ ] **P0**: Schemas ship in the published package at stable, documented paths
  - Both schema files are included in the package at fixed paths that don't change between releases.
  - The documented public URL points at a package CDN with a major-version range (for example `@0` while the tool is pre-1.0), so editors pick up compatible schema updates automatically.
  - Changing the documented URL or the paths counts as a breaking change and is called out in the changelog.
- [ ] **P0**: Configuration files the tool creates carry a schema-association header
  - Every new maester manifest or citadel configuration written by any flow (walkthroughs, non-interactive creation, apply with create, invite and handoff drafts) begins with an editor schema-association comment pointing at the documented URL.
  - Edits to an existing file never add, remove or change this header unless the user explicitly asks for it to be added.
  - The header doesn't affect parsing. A file with or without it loads identically.
- [ ] **P1**: Users can add the schema header to existing configuration files
  - A command adds the header to whichever configuration files exist in the current directory. Comments, key order and content are otherwise unchanged, and the write is atomic.
  - Running it on a file that already has a matching header changes nothing and reports that.
  - A file whose header points elsewhere is reported and left alone unless the user confirms replacing it.
- [ ] **P1**: Schemas carry descriptions and examples so editors show field help
  - Every top-level and nested field has a one-sentence description. Fields with non-obvious behavior (mode precedence, `excludes` applying only to whole-repository sources, an empty `documents` list meaning the whole repository) say so.
  - Enumerated values carry per-value descriptions where the meaning isn't self-evident (for example `canon` vs `draft`).
- [ ] **P1**: The docs explain hand-authoring a manifest with no install
  - The docs contain a minimal copy-pasteable manifest with the header included, and say editors will validate it without the tool installed.
  - They state plainly that the schema is advisory and that the consuming citadel's sync is the final check.
- [ ] **P2**: Schemas are submitted to the public editor schema catalog
  - A catalog entry is prepared that associates each schema with its file name (`maester.yaml`, `citadel.yaml`) and the documented URL, and is submitted upstream.
  - Until it's accepted, the header remains the documented mechanism. After acceptance, the docs mention that the header is optional in catalog-aware editors.

## 5. Dependencies

- [Maester Configuration](maester-configuration.md) and [Citadel Initialization](citadel-initialization.md): the two file formats being described.
- [Config Editing](config-editing.md): the comment-preserving atomic write path the add-header command reuses. It also sets the "never change what the user didn't ask for" rule that keeps edits from touching the header.
- [AI-Aided Maester Definition](ai-aided-maester-definition.md): `apply` with create is one of the creation paths that must write the header.

**External dependencies:**
- A public package CDN that serves files from published package versions by version range.
- The public editor schema catalog, for the P2 submission.

## 6. Assumptions & Risks

**Assumptions:**
- The runtime validation definitions can be converted to JSON Schema without losing the constraints users most often get wrong (unknown keys, enumerations, slug patterns).
- Most authors use an editor with YAML schema support, either built in or via a common extension.

**Risks & mitigations:**
- **The schema and runtime disagree.** Generation from one source plus the automated drift check keep them aligned. Where the schema is looser (cross-field rules), the docs say runtime is authoritative.
- **CDN availability or caching delays.** A version-ranged URL can lag a release by minutes. Editors fall back to no validation rather than wrong validation, and sync still validates.
- **The URL moves.** The path and URL are treated as a public contract and changed only in a major release.
- **The catalog submission is rejected or slow.** The header works without it, so the P2 capability doesn't block anything.

## 7. Success Metrics

- A manifest copied from the docs into a repository with no tool installed shows validation and autocomplete in a schema-aware editor with no further setup.
- 100% of configuration files created by the tool carry the header, and 0 edits to existing files change it unless the user asked.
- The drift check catches every runtime-definition change that alters the generated schema without a matching schema update.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
