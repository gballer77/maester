---
spec-version: v1
implementation-order: 1
---

# Pretty CLI

## 1. Overview

**Feature name:** Pretty CLI

**Summary:** A shared visual styling layer for the CLI that gives every command consistent, themed, terminal-aware output — colors, spacing, panels, headings, and status text — built on top of a small set of styling primitives that other CLI features render through.

**Problem being solved:** A bare CLI surface (plain `print`/`echo` output, no color, no structure) feels unfinished and makes it hard for users to scan output, distinguish severity, or follow multi-step flows. This feature establishes the visual foundation so every later CLI capability — setup wizards, config commands, help screens — renders with a coherent look without each feature reinventing colors and layout. Setting this up first prevents drift and stylistic inconsistency across the CLI as it grows.

## 2. Users & Use Cases

**Primary users:** End users invoking the CLI from a terminal. Secondary internal consumers are the developers building other CLI features who render output through the styling layer.

**Key use cases:**

1. **Visual scanning.** A user runs a command and immediately distinguishes section headings, body text, success messages, warnings, and errors by color and weight — without reading every line.
2. **Status feedback.** A command finishes (or fails) and the user sees a clearly styled success/error block rather than an undifferentiated wall of text.
3. **Structured display.** A command needs to present grouped information (e.g., a summary panel, a list of items, a key/value pair); the styling layer provides the boxed/padded container so output looks intentional.
4. **Piping and CI compatibility.** A user pipes the CLI's output into a file, `grep`, or a CI log; the output is plain readable text with no escape-code noise, while still being styled in an interactive terminal.

## 3. Scope

**In-scope goals:**
- A small, reusable set of styling primitives (theme tokens, styled text helpers, panel/box container, layout helpers).
- A single source-of-truth theme (color palette, spacing scale, accent role assignments such as success / warning / error / info / muted).
- Automatic detection of TTY vs non-TTY output and graceful degradation to plain text when not on a TTY.
- Respect for the standard `NO_COLOR` environment convention and an explicit force-color override.
- Width-aware rendering that wraps or truncates cleanly to the current terminal width.

**Out-of-scope:**
- Interactive prompts, forms, multi-select, or any input-collection UI (a separate feature).
- Spinners, progress bars, or any animated/streaming components (a separate feature).
- Rendered markdown, syntax highlighting, or rich help screens (a separate feature).
- Full-screen TUI views or alternate-screen buffer applications.
- Command parsing, flag handling, or argument routing (this feature is purely the visual layer).

**Deferred ideas:**
- Configurable user themes (light/dark variants, custom palettes).
- High-contrast / color-blind accessibility palette variant.
- Per-command style overrides.

## 4. Capabilities

- [x] **P0**: A single shared theme defines the CLI's colors, spacing, and role-based accents (success, warning, error, info, muted, heading, body), and is the only source of styling values used by other CLI features.
  - All styled output across the CLI references theme tokens — no ad-hoc color literals appear in feature code.
  - Changing a theme value in one place changes it everywhere it is used.
  - The theme exposes at minimum: heading, body, muted, success, warning, error, info.

- [x] **P0**: Styled text helpers render text in each themed role (heading, body, muted, success, warning, error, info) with consistent color and emphasis.
  - Each helper produces output styled per the theme when on a TTY.
  - Helpers compose with surrounding text without leaking styling onto adjacent output.
  - Empty or whitespace-only input is handled without throwing.

- [x] **P0**: Output automatically degrades to plain, unstyled text when the destination is not an interactive terminal (pipe, redirect, CI log, non-TTY).
  - When stdout is not a TTY, output contains no ANSI escape sequences.
  - The same content remains readable and faithfully represents the structure that would be visible on a TTY (e.g., headings still stand out via text, panels still convey grouping).
  - Detection happens automatically on each invocation; the user does not need to pass a flag for the common case.

- [x] **P0**: The CLI respects the `NO_COLOR` environment variable and provides an explicit override to force color on or off.
  - When `NO_COLOR` is set (to any non-empty value), no ANSI color codes are emitted regardless of TTY state.
  - An explicit override (e.g., a `--color` flag or equivalent env var documented in the spec) can force colored output on or off, taking precedence over auto-detection.
  - Behavior is documented in the CLI's help output.

- [ ] **P1**: A panel/box primitive renders bordered, padded containers for grouping related output (summaries, status blocks, callouts).
  - Panels render with a visible border and consistent internal padding on a TTY.
  - Panel content wraps to the panel's interior width without overflowing the terminal.
  - In non-TTY output, the panel still visually groups its content (e.g., via blank lines or a simple delimiter) instead of disappearing entirely.

- [ ] **P1**: Output adapts to the current terminal width — long lines wrap or truncate cleanly, and layout primitives never exceed the terminal width.
  - When the terminal width is known, multi-line content wraps at word boundaries within that width.
  - When width is unavailable (e.g., non-TTY), a sensible default width is used and content is not truncated mid-word.
  - Resizing the terminal between commands picks up the new width on the next invocation.

- [ ] **P1**: A small set of layout helpers (vertical stack with consistent spacing, horizontal key/value rendering, indented blocks) lets other CLI features compose multi-element output without managing spacing manually.
  - Stacked elements have predictable, theme-defined spacing between them.
  - Key/value pairs align consistently within a single rendering.
  - Indented blocks indent every line of their content, including wrapped lines.

## 5. Dependencies

**Feature dependencies:** None. This feature is foundational; all later CLI features that render output should depend on this one.

**External dependencies:** A terminal styling / layout library (specific choice deferred to `gspec/stack.md`).

## 6. Assumptions & Risks

**Assumptions:**
- The CLI's primary distribution target is an interactive terminal on a developer-class machine (modern shell, 256-color or truecolor support common).
- All CLI output that needs styling will route through this feature's helpers rather than writing styled output directly — enforced by convention in the codebase.
- A single default theme is sufficient for the initial release; user-configurable themes are deferred.

**Risks and mitigations:**
- *Inconsistent adoption — features bypass the layer and emit raw output.* Mitigation: make the styling helpers the most ergonomic way to print, and treat any raw color literal as a defect during review.
- *Over-styled output reduces readability.* Mitigation: keep the palette small (a handful of roles), reserve bright/saturated colors for status accents only, default body text to the terminal's foreground color.
- *Inaccessible color choices.* Mitigation: choose accent colors that remain distinguishable on both light and dark terminal backgrounds; treat a high-contrast/accessibility variant as a deferred follow-up rather than a hidden requirement.
- *Width detection edge cases (very narrow terminals, headless environments).* Mitigation: define a minimum sensible width and a documented fallback width; never crash on missing width information.

## 7. Success Metrics

1. **Coverage:** 100% of user-visible CLI output is rendered through the styling layer's helpers (zero raw color literals or hand-rolled ANSI codes in feature code).
2. **Non-TTY cleanliness:** Piping the CLI's output through `cat`, `grep`, or to a file produces output containing no ANSI escape sequences in every command.
3. **Visual consistency:** Every CLI command's output uses the same role colors and spacing for the same semantic roles (headings look the same everywhere; errors look the same everywhere).
4. **Theme change locality:** Changing a single theme token (e.g., the "error" accent color) updates every error message across the CLI in one edit.

## 8. Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
