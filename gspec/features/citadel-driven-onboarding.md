---
spec-version: v1
---

# Citadel-Driven Onboarding

## 1. Overview

**Feature name:** Citadel-Driven Onboarding

**Summary:** A citadel maintainer can draft a maester manifest for a source repository they don't own and hand it to that repository's owners. The draft is delivered as a ready-to-apply patch or, on request, as a pull or merge request. Two entry points:
- **invite:** drafts a manifest from the source's detected documentation layout.
- **handoff:** turns the filter set the citadel already maintains for a source into a manifest the source can own.

**Problem being solved:**
- Onboarding a maester depends on the source repository's owners doing the work. They are usually the people least motivated to do it, because the value lands in the citadel, not in their repository.
- The citadel maintainer, who wants the docs, already has a fetched copy of the source and often a working filter set. There's no way to turn that knowledge into a proposal the owners only need to approve.
- A citadel that keeps its own filter for a repository it doesn't own breaks silently when that repository restructures. Moving ownership of the filter to the source is the long-term fix, but today there's no path to it.

## 2. Users & Use Cases

**Primary users:**
- Citadel maintainers who aggregate documentation from repositories owned by other teams
- Source repository owners receiving a proposed manifest (as reviewers, not tool users)

**Key use cases:**
1. **Invite a team's repository.** A citadel maintainer has a source that currently publishes the whole repository. They run invite for it, review the drafted entries, and get a patch plus a short message to paste into the owning team's chat. The team applies it and merges.
2. **Open the request for them.** The same maintainer has push access on the source's code host. They ask invite to open a request instead. After confirming the repository, branch and description, a pull request (or merge request) appears with the drafted manifest.
3. **Hand off an existing filter.** A source has been includes-driven for months, with four enriched includes entries carrying categories and state. Handoff converts them into an equivalent manifest and delivers it. Once the owners merge it, the maintainer completes the handoff, the citadel's includes are removed, and the source becomes manifest-driven with no change in synced output.
4. **Self-hosted code host.** A source lives on a self-hosted instance of a supported code host. The request is opened through the user's existing command-line login for that host.

## 3. Scope

**In-scope goals:**
- An invite command that drafts a manifest for a configured git source from the same documentation-layout detection quick publish uses.
- A handoff command that drafts a manifest from an includes-driven source's includes, and a completion step that removes the includes once the source publishes its own manifest.
- Patch-file delivery by default, with a short message for the source's owners.
- Optional opening of a pull or merge request on GitHub and GitLab (hosted or self-hosted) through the user's own installed and authenticated command-line client, always after explicit confirmation.
- Drafted manifests that identify how they were produced and ask for review before merging.

**Out-of-scope:**
- Storing or requesting code-host credentials. Opening a request relies entirely on the user's existing command-line client login.
- Forking a repository when the user lacks push access. The tool falls back to patch delivery instead.
- Code hosts other than GitHub and GitLab for request opening. Patch delivery works for any host.
- Local path sources. Their owners run publish in that directory directly.
- Any model call. Drafting is deterministic.
- Tracking whether a request was merged, beyond the explicit handoff completion step.

**Deferred ideas:**
- Forking and opening a request from the fork when the user lacks push access.
- Opening requests on further code hosts.
- A citadel-wide view of which sources are whole-repository, includes-driven or manifest-driven, with an onboarding suggestion for each.
- Re-inviting a source whose manifest has drifted from its detected layout.

## 4. Capabilities

- [ ] **P0**: Invite drafts a manifest for a configured git source
  - Invite takes a source name from the citadel configuration. It accepts git sources whose remote has no manifest or an empty one (whole-repository). If the remote already publishes a manifest, invite refuses and says so. Includes-driven sources are pointed at handoff instead.
  - The draft is built from the source's fetched copy at its configured ref, fetching it first if the cache is missing. It contains exactly the documentation-layout suggestions quick publish would make in that tree, with their categories.
  - The draft begins with a comment stating that it was drafted by the tool from a named citadel and should be reviewed before merging, followed by the schema header.
  - Before any output is written, the user sees the drafted entries with their reasons. They can confirm, or deselect entries. If nothing is detected, invite exits non-zero, writes nothing, and suggests handoff (declare includes first) or the owner running the walkthrough.
- [ ] **P0**: Drafts are delivered as a patch with a message for the source owners by default
  - Output is a patch that adds the manifest at the source repository's root and applies cleanly to the configured ref. Next to it is a plain-text message explaining what the manifest does, what the citadel will pull once it's merged, and how to apply the patch.
  - Both files are written under the tool's local working directory for that source. Their paths are printed together with the one-line apply command.
  - Default delivery never contacts the source's remote beyond the fetch it already performs.
- [ ] **P0**: Handoff drafts a manifest from an includes-driven source's filter set
  - Handoff accepts includes-driven git sources only. Each includes entry becomes one manifest entry with the same path, and enriched entries carry their state, category and tags over unchanged.
  - The draft is checked against the source's fetched tree. It must resolve to the same set of files the includes resolve to today, and any difference is reported before delivery.
  - Delivery, confirmation and the drafted-by comment behave exactly as for invite.
- [ ] **P1**: The user can open a pull or merge request instead of writing a patch
  - A flag requests a pull request (GitHub) or merge request (GitLab, hosted or self-hosted). The host is inferred from the source URL. The user's installed command-line client for that host is used with its existing login.
  - Before anything is pushed, the user sees the target repository, the new branch name, the base branch (the configured ref), the title and the description, and must confirm. Declining falls back to writing the patch.
  - If the host is unsupported, the client is missing or not logged in, or the user lacks push access, the tool explains why, writes the patch instead, and exits zero.
  - On success, the request URL is printed.
- [ ] **P1**: The user can complete a handoff once the source publishes its manifest
  - A completion step for a handed-off source checks that the remote now publishes a non-empty manifest at the configured ref. It then removes that source's includes from the citadel configuration, preserving comments and every other entry.
  - If the remote has no manifest yet, completion refuses and changes nothing.
  - If the remote manifest resolves to a different file set than the includes, completion lists the differences and needs confirmation.
- [ ] **P1**: Sync points out sources that are ready to hand off or complete
  - When an includes-driven source's remote publishes a non-empty manifest that the includes override, sync prints a one-line hint to complete the handoff.
  - The hint is silenced by the existing quiet option.
- [ ] **P2**: Invite can draft for every eligible source at once
  - An all-sources option drafts a patch and message for every whole-repository git source. It prints a summary of which sources got a draft and which had nothing detected.
  - Request opening is not available in this mode. It's patch-only.

## 5. Dependencies

- [Quick Publish](quick-publish.md): the deterministic documentation-layout detection that invite drafts from.
- [Config JSON Schemas](config-json-schemas.md): the schema header drafted manifests carry.
- [Whole-Repository Sources](whole-repository-sources.md): defines which sources are eligible for invite, and the source-mode precedence handoff completion relies on.
- [Maester Sync](maester-sync.md): the fetched source cache drafts are built from, and where the handoff hint appears.
- [Document Category and Tags](document-category-and-tags.md) and [Document State Tagging](document-state-tagging.md): the enriched includes fields carried over by handoff.
- [Config Editing](config-editing.md): the comment-preserving atomic write used when handoff completion removes includes.

**External dependencies:**
- GitHub and GitLab command-line clients, installed and authenticated by the user, needed only for request opening.
- Push access to the source repository, needed only for request opening.

## 6. Assumptions & Risks

**Assumptions:**
- Citadel maintainers usually have read access to source repositories, and sometimes push access.
- Source owners are more likely to accept a ready-made, reviewable change than to run a tool themselves.
- The user's code-host command-line client is the right place for authentication; the tool doesn't need its own.

**Risks & mitigations:**
- **Unwanted requests on other teams' repositories.** Opening a request is opt-in, needs explicit confirmation showing exactly what will be created, and is never available in all-sources mode.
- **The draft publishes something the owners didn't intend.** Sensitive files are never suggested. The draft says it was machine-drafted and needs review. The owners merge it, so nothing takes effect without their approval.
- **Handoff changes what the citadel pulls.** Handoff checks file-set equivalence before delivery, and completion checks it again before removing includes.
- **Code-host client behavior varies across versions.** Any client failure falls back to patch delivery, so the user always ends up with something to deliver.

## 7. Success Metrics

- A citadel maintainer can go from a whole-repository source to a deliverable patch in one command with one confirmation.
- Handoff followed by completion leaves the source's synced file set identical, unless the user confirmed listed differences.
- No request is ever opened without an explicit confirmation in the same run.
- Every client or permission failure during request opening still results in a written patch.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
