---
spec-version: v1
implementation-order: 5
---

# CLI Banner

## 1. Overview

**Feature name:** CLI Banner

**Summary:** A themed ASCII-art banner rendered only on `maester --help`, `maester --version`, and the first-run welcome screen. Size variants adapt to terminal width, and the banner is automatically suppressed in non-interactive contexts. Routine commands never render the banner.

**Problem being solved:** The CLI needs a recognizable visual identity for the moments where a first impression matters — a new user's first invocation, and the help and version screens that anchor the tool's "front page." A signature ASCII banner gives the tool a distinctive look at those moments without making it intrusive on routine, repeated invocations. The style guide explicitly forbids banners on every command for that reason; this feature delivers the banner exactly where the style guide allows it.

## 2. Users & Use Cases

**Primary users:** End users invoking the CLI from a terminal.

**Key use cases:**

1. **First-impression brand recognition.** A user runs the CLI for the first time in a repository and sees a distinctive ASCII banner above the welcome message — the tool's identity registers before any prompts or output appear.
2. **Help and version "front page".** A user runs `maester --help` or `maester --version` to discover the tool or check its release, and the banner anchors that screen as the canonical surface for those commands.
3. **Quiet on routine commands.** A user running everyday commands (e.g. `maester check`, `maester pull`, or the top-level menu after first-run) sees no banner at all — the tool stays out of the way for repeated invocations.
4. **Clean piped output.** A user pipes the CLI's output into `grep`, a log file, or a CI runner; the banner is suppressed automatically and the captured output is free of decorative noise.
5. **Opt-out for the first-run welcome.** A user who has already adopted the tool and prefers terse output can suppress the first-run welcome banner via an explicit flag or environment variable (e.g. for scripted setup).

## 3. Scope

**In-scope goals:**
- A single canonical ASCII-art illustration (themed to the product), shown at exactly three points: `maester --help`, `maester --version`, and the first-run welcome screen.
- Two pre-authored size variants — a full version for wide terminals and a compact version for narrower terminals — auto-selected by the current terminal width.
- Rendering through the established CLI styling layer so the banner inherits theme colors and respects all existing color/TTY rules.
- Automatic suppression in non-TTY contexts (pipes, redirects, CI logs).
- Automatic suppression on every routine command (anything other than `--help`, `--version`, and first-run).
- An explicit user opt-out (flag and/or environment variable) for the first-run welcome banner.
- Graceful fallback when the terminal is too narrow even for the compact variant (the banner is skipped, the CLI continues normally).

**Out-of-scope:**
- Banners or art rendered at any moment other than `--help`, `--version`, and first-run (e.g. routine commands, success screens, error screens, sync completion). Those may be added as separate features later.
- Animated banners (frame-by-frame redraws, blinking elements, typewriter effects).
- User-configurable banner content or user-supplied art.
- Multiple thematic variants chosen by context (e.g. day/night, seasonal).
- Localization of any text embedded in the banner.

**Deferred ideas:**
- Themed seasonal or contextual variants.
- Inclusion of the CLI's version number rendered alongside the banner.

## 4. Capabilities

- [ ] **P0**: A canonical ASCII-art banner is displayed at exactly three points — `maester --help`, `maester --version`, and the first-run welcome screen — and nowhere else.
  - On those three surfaces, the banner appears as the first content rendered to stdout on an interactive terminal.
  - Routine commands (anything other than `--help`, `--version`, and first-run) never render the banner.
  - Banner content is fixed and version-controlled — every invocation under the same release shows the same art.
  - The banner does not require user input and does not block on anything (rendering is synchronous and instant).

- [ ] **P0**: Two size variants exist (a full version and a compact version), and the CLI auto-selects which to render based on the current terminal width.
  - When the terminal width is at or above a defined threshold, the full banner is rendered.
  - When the width is below that threshold but at or above a compact-variant minimum, the compact banner is rendered.
  - The two variants depict the same subject and feel like the same brand mark at different scales.

- [ ] **P0**: The banner is suppressed automatically when output is not going to an interactive terminal.
  - When stdout is not a TTY (piped, redirected, CI log), the banner is not rendered at all — no escape sequences and no plain-text fallback.
  - Detection happens automatically; the user does not need to pass a flag for the common non-TTY case.
  - This behavior matches the auto-detection rules already established by the CLI's styling layer.

- [ ] **P0**: The banner is rendered through the CLI's styling layer and inherits its theme.
  - Banner colors come from theme tokens defined by the styling layer; no hard-coded color literals appear in banner code.
  - The banner respects `NO_COLOR` and any explicit color override flags already supported by the styling layer.
  - Changing a relevant theme token updates the banner's coloring without touching banner-specific code.

- [ ] **P1**: A user can explicitly suppress the first-run welcome banner via a documented flag and/or environment variable.
  - When the opt-out is active, the first-run welcome banner is not rendered regardless of terminal width or TTY state.
  - The opt-out does not affect `--help` or `--version`, where the banner is explicitly requested by the invocation.
  - The opt-out is discoverable from the CLI's help output.

- [ ] **P1**: When the terminal is too narrow for even the compact variant, the banner is skipped without breaking the CLI.
  - If the terminal width is below the compact-variant minimum, no banner is rendered and the CLI proceeds normally.
  - No partial or wrapped banner is ever emitted — the banner is rendered in full or not at all.
  - The skip is silent (no warning or error to the user).

## 5. Dependencies

**Feature dependencies:**
- **[Pretty CLI](pretty-cli.md)** — the banner renders through the styling layer's theme tokens and inherits its TTY/color rules. This feature should be built after Pretty CLI is in place.

**External dependencies:** None beyond what the styling layer already requires.

## 6. Assumptions & Risks

**Assumptions:**
- The CLI has well-defined detection points for `--help`, `--version`, and first-run, so the banner can be rendered uniformly at each.
- The CLI has a reliable way to detect "first-run" — for example, the absence of any maester or citadel configuration file in the working tree, or a small marker file written after the first interactive run. The exact mechanism is an implementation detail.
- The styling layer already handles TTY detection, `NO_COLOR`, and color overrides; the banner reuses those mechanisms rather than reimplementing them.
- A single subject for the banner art (themed to the product) is sufficient for the first release; thematic variants are deferred.
- Two size variants (full and compact) cover the practical range of terminal widths used by the target audience.

**Risks and mitigations:**
- *Banner becomes visual noise on routine commands.* Mitigation: this feature scopes the banner to `--help`, `--version`, and first-run only — routine commands never render it.
- *First-run welcome banner annoys users who run the CLI in scripted setup.* Mitigation: the P1 opt-out flag and environment variable suppress the first-run welcome banner.
- *Banner art breaks under unusual terminal widths or non-monospace fonts.* Mitigation: pre-author the variants at fixed widths and skip rendering entirely when the terminal is below the compact minimum; never auto-resize art.
- *Banner content leaks into piped or CI output.* Mitigation: rely on the styling layer's TTY detection — the banner is gated on the same signal as themed colors, so the two behaviors stay aligned.
- *Color choices clash with user terminal themes.* Mitigation: route all banner colors through the existing theme tokens; the banner cannot introduce colors the rest of the CLI does not already use.

## 7. Success Metrics

1. **Visibility on the intended surfaces:** The banner renders on 100% of interactive-terminal `--help`, `--version`, and first-run invocations (when the terminal meets the minimum width and the user has not opted out of the first-run welcome).
2. **Quiet on routine commands:** The banner renders in 0% of routine command invocations (anything other than `--help`, `--version`, and first-run).
3. **Non-TTY cleanliness:** Piping the CLI's output into `cat`, `grep`, or a file produces output containing no banner content and no ANSI escape sequences from the banner.
4. **Width safety:** Across the supported range of terminal widths (from the compact minimum upward), the banner never wraps, truncates, or overflows the terminal width.
5. **Opt-out compliance:** When the documented first-run suppression flag or environment variable is set, the first-run welcome banner is rendered in 0% of first-run invocations.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
