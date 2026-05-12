# Deployment

Maester is published as an npm package. There is no hosted service; the "deploy target" is the npm registry.

## Hosting Environment

- **Registry:** https://registry.npmjs.org (public)
- **Tag:** `latest`
- **Distribution:** consumers run `npx maester` or install via `npm i maester`.

A maintainer with publish rights on the npm `maester` package, or with permissions on the GitHub repository to push tags, can release.

## Pre-Deployment Checklist

1. `pnpm run prepublishOnly` is green locally (`lint` + `typecheck` + `test` + `build`).
2. `CHANGELOG.md` updated with the new version's entries.
3. Version bumped in `package.json` and committed.
4. The `NPM_TOKEN` secret is configured in the GitHub repository (used by `release.yml`).

## Deployment Steps

Releases are driven by **annotated git tags**:

```sh
git tag -a v0.1.0 -m "v0.1.0 — initial release"
git push origin v0.1.0
```

The push triggers `.github/workflows/release.yml`, which:

1. Installs dependencies with the frozen lockfile.
2. Runs the full quality gate (`pnpm run prepublishOnly`).
3. Publishes to npm with `--provenance` (OIDC trusted publishing — no long-lived token in the workflow).
4. Creates a GitHub Release with auto-generated notes from commit history.

There is no manual `npm publish` step. If the workflow fails, fix the underlying issue and re-tag.

## Post-Deployment Verification

1. `npm view maester version` returns the expected version.
2. `npx maester@<version> --help` runs cleanly in a fresh shell.
3. `npx maester@<version>` in an empty repo shows the welcome banner and top-level menu.
4. The GitHub Release page lists the new tag with generated notes.

## Rollback Procedure

If a published version is broken:

1. **Deprecate** the broken version on the registry rather than deleting it:
   ```sh
   npm deprecate maester@<version> "<reason — link to the issue or fix>"
   ```
2. Publish a patched version (`v0.1.0` → `v0.1.1`) following the same tag-driven flow.
3. Optionally `npm dist-tag add maester@<previous-version> latest` to point new installs at the previous good version while the patch is in flight.

`npm unpublish` is reserved for genuinely accidental publishes (e.g. a leaked secret) and only works within 72 hours; prefer deprecation.

## Domain & DNS

Not applicable. Maester is a CLI package distributed via npm; no custom domain is configured.
