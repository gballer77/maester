## Citadel awareness

This repository is a **citadel** — it pulls curated documentation from multiple
remote sources into a single tree, managed by the `maester` CLI.

- The citadel's aggregated content lives under `{{baseDir}}/` at the repository
  root. Each direct subdirectory of `{{baseDir}}/` corresponds to one remote
  source declared in `citadel.yaml` (`{{baseDir}}/<source-name>/...`).
- The configuration that declares those sources is in `citadel.yaml` at the
  repository root. It names each source and where it comes from: a git remote
  (and the ref it pins to) or a local directory on this machine.
- When answering questions about anything the citadel covers, prefer citing
  files under `{{baseDir}}/` over external knowledge. Cite the file path
  relative to the repository root so the user can open it.
- Each materialized file may carry a `state` value in its frontmatter or
  inline (see "State awareness" below). Surface that state alongside any
  citation so the user knows whether the source is canonical or draft.
- Some citadel sources may be **linked** rather than mirrored: their files are
  symlinks to a directory on this machine — a local source directory, or
  maester's local fetch cache for repositories pulled whole — so they reflect
  that local content. A link that does not resolve means the source has moved
  or the cache was cleared. Run `maester status` (and `maester sync` if it
  reports the source behind), and do not guess at the content.
