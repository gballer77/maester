---
spec-version: v1
---

# Visual Style Guide

## 1. Overview

### Design Vision
A terminal-native interface that feels calm, modern, and precise. The CLI gets out of the way: most output is the user's terminal default, with a single mint accent doing the work of drawing the eye to choices, focus, and outcome. ASCII art and box-drawing appear in service of clarity — never as decoration — and the interface degrades gracefully through 256-color terminals, monochrome pipes, and screen readers without losing meaning.

### Target Platforms
- **Interactive TTY** — the primary surface. Modern terminal emulators on macOS, Linux, and Windows (Terminal, iTerm2, Alacritty, WezTerm, Kitty, VS Code integrated terminal). Truecolor assumed when `COLORTERM=truecolor`; otherwise 256-color fallback applies.
- **Non-TTY / piped output** — stdout redirected to files, pipes, or CI logs. All color and animation suppressed; output remains parseable plain text.
- **`--json` mode** — machine-readable stream. No styling, no glyphs, no progress UI. Out of scope for this document.

### Visual Personality
Sleek, technical, restrained. The aesthetic borrows from the modern Go/Rust TUI generation (gum, fzf, lazygit, bubbletea apps): plenty of breathing room, light box-drawing, one accent color, generous use of dim text for secondary information. Banners and ASCII art appear sparingly — at first run, in `--help`, and for completion screens — never on every command.

### Design Rationale
A CLI tool that runs in a developer's terminal is a guest in someone else's themed environment. We respect the user's terminal background and font, override as little as possible, and rely on contrast (bold, dim) and a single accent color to organize information. This keeps the tool readable across hundreds of terminal themes the project will never test against, while still feeling like a deliberately designed product.

---

## 2. Color Palette

All canonical values are hex (truecolor). The 256-color column gives the nearest xterm-256 index for terminals that don't advertise `COLORTERM=truecolor`. Selection happens at output time, not at config time — the renderer picks the right column.

### Primary Accent

| Token | Hex | 256 | Usage |
|---|---|---|---|
| `accent` | `#7CE7C7` | `121` | Selection cursor (`▸`), focused option, primary calls-to-action in help text, link-like emphasis. Used sparingly — one accent on screen at a time wherever possible. |

**Rationale.** Mint cyan reads cleanly on both dark and light terminal backgrounds (the two dominant theme families), passes WCAG AA against `#000000` (contrast 12.3:1) and against `#FFFFFF` (1.7:1 — used only against dark backgrounds for body; against light we drop to `accent-strong`). It has no inherited brand meaning, no traffic-light connotation that would confuse it with success/warning/error, and it sits visually adjacent to but distinct from the success green.

| Token | Hex | 256 | Usage |
|---|---|---|---|
| `accent-strong` | `#2BA88A` | `36` | The accent on **light** terminal backgrounds, where mint loses contrast. The renderer swaps `accent` → `accent-strong` when background detection reports a light theme. |

### Secondary Accent

| Token | Hex | 256 | Usage |
|---|---|---|---|
| `accent-alt` | `#B197FC` | `141` | Reserved for situations where two simultaneous emphases must be distinguished — e.g., the "new" item in a diff list while the primary accent marks the cursor. Use rarely; if you reach for it more than once per screen, redesign the screen. |

### Neutral / Text

The default foreground and background are **always the user's terminal defaults**. The tool never paints a full background fill. The neutral tokens below modulate the default foreground.

| Token | Effect | Hex (on dark) | 256 | Usage |
|---|---|---|---|---|
| `fg-default` | terminal default | — | — | Body text, prompts, labels. No explicit color applied. |
| `fg-muted` | dimmed | `#8A8A8A` | `245` | Secondary information: help hints, keybinding legends, metadata, the un-focused rows of a select list. Rendered with ANSI `dim` (SGR 2) where supported; explicit hex elsewhere. |
| `fg-faint` | very dim | `#5A5A5A` | `240` | Tertiary information: timestamps, byte counts, separator lines. Should never carry information the user must read to act. |
| `fg-strong` | bold | — | — | Headings, command names in body text, summary totals. Rendered with ANSI `bold` (SGR 1); no explicit color. |

### Semantic Colors

| Token | Hex | 256 | Usage | Contrast on `#000` |
|---|---|---|---|---|
| `success` | `#6ED49B` | `78` | Completed actions, passing checks, the `✓` glyph. | 10.9:1 ✓ AA |
| `warning` | `#F0C674` | `222` | Recoverable issues, deprecation notices, the `!` glyph. | 12.6:1 ✓ AA |
| `error` | `#FF6B6B` | `203` | Failed commands, fatal errors, the `✗` glyph. Always paired with text — never color alone. | 7.1:1 ✓ AA |
| `info` | `#74A9F0` | `111` | Neutral informational notes, the `›` glyph in `--verbose` logs. | 8.1:1 ✓ AA |

**Rule:** semantic color always co-occurs with a glyph and a text label, so meaning survives `NO_COLOR=1` and colorblind users.

### Color Selection Algorithm

At process start, the renderer detects:
1. `NO_COLOR` env var → all color disabled, monochrome rendering only.
2. `FORCE_COLOR` env var → respected per [force-color spec](https://force-color.org/).
3. Not a TTY → color disabled.
4. `COLORTERM=truecolor` or `COLORTERM=24bit` → truecolor hex values.
5. `TERM` contains `256color` → 256-color indices.
6. Otherwise → 16-color ANSI named fallback (bright cyan for `accent`, etc.).

Background detection (light vs dark) uses the `COLORFGBG` env var when present; otherwise assume dark.

---

## 3. Typography

A CLI does not choose its font — the user's terminal does. The tool's "typography" is the system of ANSI weights, styles, and casing it applies to characters the terminal will render.

### Font Family
Whatever the user has configured. The tool **must remain legible in monospace fonts** with and without ligatures (e.g., Menlo, JetBrains Mono, SF Mono, Cascadia, IBM Plex Mono). Test ASCII art and box-drawing in at least one ligature font to confirm box corners and arrows render at the expected width.

### Type Scale

There is no point size scale — there is one cell size, set by the terminal. We modulate emphasis with ANSI SGR codes:

| Role | SGR | Effect | Use for |
|---|---|---|---|
| Heading | `1` (bold) | Bold default fg | Section headings in `--help`, banner labels, summary lines. |
| Body | none | Default fg | Almost everything. |
| De-emphasized | `2` (dim) | Faint default fg | Hints, keybinding legends, metadata. |
| Emphasis | `3` (italic) | Italic if supported, else no change | Quoted user input echoed back, file paths in prose. Never load-bearing — italic support varies. |
| Underline | `4` | Underline if supported | URLs in help text. The renderer additionally writes OSC-8 hyperlinks so iTerm2/Wezterm make them clickable. |
| Inverse | `7` | Swap fg/bg | The "current" row in a paged list, the cursor character in input prompts. |
| Strikethrough | `9` | Line through if supported | Items removed from a set in a diff view. Never load-bearing. |

### Line Height & Letter Spacing
Fixed by the terminal cell grid. Not configurable. The only related decision is **blank lines between blocks** — see Spacing.

### Casing Conventions

- **Command names**: lowercase, bold (`maester check`).
- **Flag names**: lowercase, bold, with leading dashes intact (`--verbose`).
- **Environment variables**: ALL_CAPS, bold (`COLORTERM`).
- **File paths**: italic when supported, else default (`gspec/style.md`).
- **Headings in `--help` output**: Title Case, bold.
- **Prompts**: sentence case, ending with a colon or question mark.

---

## 4. Spacing & Layout

### Spacing Scale

There is no pixel; there is the cell. All spacing is measured in **characters horizontally** and **rows vertically**.

| Token | Cells | Use for |
|---|---|---|
| `space-xs` | 1 | Glyph-to-text gap (`▸ Option`); inline separator before keybinding hint. |
| `space-sm` | 2 | Standard indent unit. Each nesting level adds two spaces. |
| `space-md` | 4 | Indent inside boxed regions; gap between columns in a multi-column hint line. |
| `space-lg` | 1 blank row | Between major blocks within a screen. |
| `space-xl` | 2 blank rows | Above a top-level heading or banner; never elsewhere. |

### Indentation

```
Question?                          ← 0 cells
  ▸ Option one                     ← 2 cells (space-sm), cursor in space-xs slot
    Option two                     ← 4 cells (2 indent + 2 for absent cursor)
    Option three

  ↑/↓ navigate · ↵ select · q quit ← 2 cells, dim
```

Note that the cursor `▸` and its trailing space occupy the same two cells whether present or absent. This is non-negotiable: rows must not horizontally shift as the cursor moves.

### Column Conventions

Layouts target a **default content width of 72 cells** for prose (help text, descriptions). Tables, boxed regions, and progress bars expand to fill `min(terminal_width, 100)` cells. Below 60 cells of terminal width, drop to single-column rendering everywhere — see Responsive.

### Grid System
Not applicable in the visual-grid sense. The terminal is the grid.

### Layout Patterns

Every interactive screen follows a three-block pattern:

```
┌─ Question / heading ──── space-lg ─────┐
│                                         │
│  Body (options, input field, summary)   │
│                                         │
├──── space-lg ──────────────────────────┤
│  Keybinding legend (dim, one line)      │
└─────────────────────────────────────────┘
```

The boxed frame above is illustrative — the actual tool does **not** wrap interactive prompts in a box by default. Boxes are reserved for the components in §6.

---

## 5. Themes

The tool runs in the user's terminal, which has its own theme. "Light mode" and "dark mode" here describe how we **adapt to the host theme**, not separate palettes we paint.

### Dark Mode (assumed default)

| Surface | Treatment |
|---|---|
| Background | User's terminal background. Never overridden. |
| Body text | Default foreground. |
| Accent | `#7CE7C7` |
| Muted | ANSI `dim` SGR, or `#8A8A8A` as explicit hex. |
| Box-drawing | Default fg with `dim` SGR. |

### Light Mode

Detected via `COLORFGBG` (background luminance > 0.5) when available. Otherwise opt-in via `--theme=light` or `MAESTER_THEME=light`.

| Surface | Treatment |
|---|---|
| Background | User's terminal background. Never overridden. |
| Body text | Default foreground. |
| Accent | `#2BA88A` (the mint loses too much contrast on white). |
| Muted | ANSI `dim`. The explicit hex `#8A8A8A` works adequately on white but we prefer SGR `dim` here so the user's theme can adjust. |
| Box-drawing | Default fg with `dim` SGR. |

### High Contrast / `NO_COLOR`

When `NO_COLOR` is set:
- All color SGR codes suppressed.
- Bold, dim, italic, underline, inverse remain (these are styles, not colors).
- The cursor `▸` keeps its visual role; selection contrast comes from `inverse` (SGR 7) on the focused row instead of accent color.
- Semantic glyphs (`✓ ! ✗ ›`) remain in front of every status message.

---

## 6. Component Styling

CLI "components" are output patterns, not widgets. This section defines how each renders.

### 6.1 Selection Menu (single-select)

```
  Choose a source type

  ▸ Git repository
    Google Drive
    Web URL

  ↑/↓ navigate · ↵ select · esc cancel
```

- Cursor glyph: `▸` (U+25B8). Fallback for non-Unicode terminals: `>`.
- Cursor color: `accent`.
- Focused row label: `fg-default`, no bold (selection is conveyed by cursor + color, not weight — bold here looks shouty).
- Unfocused rows: `fg-default` at full strength. (Don't dim un-focused rows in short lists; it makes the unselected options look unavailable.)
- For lists ≥ 8 items, dim un-focused rows with SGR `dim` to reduce visual noise, and add a scrollbar gutter `│` on the right.
- Keybinding legend: `fg-muted`, separated by middle dot ` · `.

### 6.2 Multi-Select

```
  Select capabilities to enable

    ◯  init command
    ◉  check command
  ▸ ◉  pull command
    ◯  diff command

  ↑/↓ navigate · space toggle · ↵ confirm
```

- Off marker: `◯` (U+25EF). Fallback: `[ ]`.
- On marker: `◉` (U+25C9), `accent` color. Fallback: `[x]`.
- Cursor + marker spacing: 1 cell between cursor and marker, 2 cells between marker and label.

### 6.3 Confirm

```
  Overwrite existing config? (y/N) ▸ _
```

- Default answer is capitalized in the `(y/N)` hint.
- Cursor `▸` precedes the input slot, `accent`.
- The `_` is the actual cursor cell (rendered by the terminal); the prompt does not draw it.

### 6.4 Text Input

```
  Repository URL
  ▸ https://github.com/_

  · must be an HTTPS or SSH git remote
```

- Label on the line above the input, `fg-strong` (bold).
- Cursor `▸`, `accent`.
- Helper text below the input, `fg-muted`, prefixed with `· ` (U+00B7 + space).
- Error state: the `·` becomes `✗` in `error` color, the helper-text color becomes `error`, and the cursor `▸` flips to `error` color as well.

```
  Repository URL
  ✗ not-a-url

  ✗ must be an HTTPS or SSH git remote
```

### 6.5 Status Lines

Every line that reports an outcome opens with a status glyph in semantic color, followed by a space, then the message in `fg-default`:

```
  ✓  Cloned 3 sources              fg=success on glyph, default on body
  ›  Skipping cached source        fg=info on glyph, muted on body
  !  Retrying after rate limit     fg=warning on glyph, default on body
  ✗  Failed to fetch X             fg=error on glyph, default on body
```

ASCII fallbacks when Unicode is unavailable: `[ok] [..] [!!] [ER]`.

### 6.6 Boxed Regions

Boxes appear only around three things: completion summaries, error reports, and welcome/help banners. Never around prompts.

```
  ┌─ Summary ──────────────────────────────┐
  │ 3 sources cloned                       │
  │ 12 documents aggregated                │
  │ 0 errors                               │
  └────────────────────────────────────────┘
```

- Light box-drawing only: `┌ ┐ └ ┘ ─ │` (U+250C, U+2510, U+2514, U+2518, U+2500, U+2502).
- Box stroke: `fg-default` with SGR `dim`.
- Title floats in the top edge, preceded and followed by a single `─`.
- Interior padding: 1 cell of horizontal padding, no vertical padding.
- Heavy box-drawing (`┏ ┓ ┗ ┛ ━ ┃`) is reserved for **error boxes only**, in `error` color.

### 6.7 Progress

**Determinate bar** (known totals):

```
  Pulling sources  ▕████████████▏░░░░░░░░░░  12/20
```

- Fill character: `█` (U+2588), `accent`.
- Track character: `░` (U+2591), `fg-faint`.
- End caps: `▕` `▏` (U+2595, U+258F), `fg-muted`. They visually anchor the bar without adding heavy borders.
- Width: 24 cells default, scales with terminal width.
- Trailing counter: `fg-muted`.

**Indeterminate spinner** (unknown duration):

```
  ⠋  Resolving dependencies
```

- Frames: `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏` (Braille block, ten frames).
- Frame rate: 80 ms per frame (~12 fps).
- Color: `accent`.
- ASCII fallback: `| / - \` at 100 ms per frame.
- On completion, the spinner glyph is replaced **in place** with `✓`, `✗`, or `!` in the appropriate semantic color, and the line becomes static.

### 6.8 Tables

```
  SOURCE              STATUS    LAST PULL
  ─────────────────   ───────   ─────────────
  api-docs            ✓ fresh   2 min ago
  design-tokens       ! stale   3 days ago
  archived/old-spec   ✗ error   never
```

- Header: bold, `fg-default`.
- Separator row: `─` characters, length matches the widest cell in each column, `fg-muted` with SGR `dim`.
- Status column: semantic glyph + space + word, glyph in semantic color, word in `fg-default`.
- Column gutter: 3 cells.
- Long values truncate with `…` (U+2026) in `fg-muted`.

### 6.9 Banners (ASCII Art)

Banners appear only in `maester --help`, `maester --version`, and the first-run welcome message. Never on routine commands.

Use a single restrained figlet specimen, **"Small Slant"** (or equivalent), rendered in `accent`:

```
                       __
    __ _  ___ ____ ___ / /____ ____
   /  ' \/ _ `/ -_|_-</ __/ -_) __/
  /_/_/_/\_,_/\__/___/\__/\__/_/
  living specs · v0.1.0
```

- One blank row above and below the banner.
- The subtitle below uses `fg-muted` and middle-dot separators.
- **Do not** use heavy block-letter banners (Big, Block, Banner3) — they consume too much vertical space for a tool people will invoke many times a day.
- Banner output is suppressed when stdout is not a TTY.

---

## 7. Visual Effects

### Animation Timing

| Effect | Interval | Notes |
|---|---|---|
| Spinner frame | 80 ms | Twelve frames per second feels alive without flicker. |
| Spinner-to-final swap | 120 ms hold | The final `✓`/`✗` glyph holds for 120 ms before the next line draws, so the user perceives the state change. |
| Progress bar redraw | 50 ms or per 1% change, whichever is rarer | Throttle redraws to avoid CPU churn on fast operations. |
| Selection cursor movement | instant | No animation; the cursor jumps to its new row. |

### Transitions

There are no page transitions. When a screen completes, its final state is left on screen (committed) and the next screen draws below it. Screens **never clear** the terminal unless `--clear` is explicitly passed or the user is in a long-running TUI mode (out of scope for this document).

### Shadows & Elevation
Not applicable.

### Border Radius
Not applicable in the geometric sense. The closest analog is **box-drawing style**:

| Style | Characters | Use for |
|---|---|---|
| Light | `┌ ┐ └ ┘ ─ │` | Default. All informational boxes. |
| Rounded | `╭ ╮ ╰ ╯ ─ │` | First-run welcome banner only — its softness signals "this is friendly, not a status report." |
| Heavy | `┏ ┓ ┗ ┛ ━ ┃` | Error summary boxes only, in `error` color. |
| Double | `╔ ╗ ╚ ╝ ═ ║` | Not used. Reads as retro/legacy and clashes with the modern minimalist direction. |

---

## 8. Iconography

### Icon Library

Unicode glyphs, hand-selected. No external icon library. Every glyph in the system below has been vetted for:
1. Presence in common monospace fonts (JetBrains Mono, SF Mono, Cascadia, Menlo, Fira Code, IBM Plex Mono).
2. Width of exactly one cell at the default terminal cell width (no East Asian wide ambiguity).
3. An ASCII fallback for cases where the glyph degrades.

| Role | Glyph | Code point | ASCII fallback | Color |
|---|---|---|---|---|
| Selection cursor | `▸` | U+25B8 | `>` | `accent` |
| Submenu / expandable | `▾` | U+25BE | `v` | `accent` |
| Collapsed | `▴` | U+25B4 | `^` | `accent` |
| Multi-select off | `◯` | U+25EF | `[ ]` | `fg-muted` |
| Multi-select on | `◉` | U+25C9 | `[x]` | `accent` |
| Success | `✓` | U+2713 | `[ok]` | `success` |
| Warning | `!` | U+0021 | `!` | `warning` |
| Error | `✗` | U+2717 | `[X]` | `error` |
| Info | `›` | U+203A | `>` | `info` |
| Bullet | `·` | U+00B7 | `-` | `fg-muted` |
| Ellipsis | `…` | U+2026 | `...` | inherit |
| Separator | ` · ` |  | ` - ` | `fg-muted` |
| Spinner frames | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | U+2807… | `\|/-\` | `accent` |
| Progress fill | `█` | U+2588 | `#` | `accent` |
| Progress track | `░` | U+2591 | `.` | `fg-faint` |

### Usage Guidelines

- One glyph at the start of each status line. Never two glyphs back-to-back.
- One cell of space between a glyph and the text that follows.
- The cursor `▸` and its space are always present in selection rows, even when not focused — replace the cursor with two spaces, not zero. This keeps rows aligned.
- Detect Unicode support via `LC_CTYPE` / `LANG` containing `UTF-8`; otherwise fall back to ASCII.

### Stroke / Weight
The user's font determines stroke. The tool should not assume thin-stroke glyphs render at the same weight as heavy block-drawing — that's why the system uses light box-drawing for routine boxes and reserves heavy box-drawing for errors, where the visual weight is intentional.

---

## 9. Imagery & Media

### Photography
Not applicable.

### Illustrations
Not applicable in the conventional sense. The CLI's "illustrations" are ASCII art — see Banners (§6.9). Rules:

- Banners are the only ASCII art allowed.
- One banner specimen per project (the figlet-style logotype). No alternates.
- Banners appear only on `--help`, `--version`, and first-run.
- Banner output suppressed when not a TTY.
- The banner is in `accent` color with `fg-muted` subtitle. No gradients, no rainbow, no multi-color.

### Placeholder Patterns
When a list, table, or summary would be empty:

```
  · no sources configured yet
  · run `maester init` to add one
```

- Two left-aligned lines.
- `fg-muted`.
- Leading bullet `·` in `fg-faint`.
- The second line offers the next action and prints the command name in `fg-strong` (bold).

---

## 10. Accessibility

### Contrast Requirements

WCAG **AA** for all text against a dark terminal background (`#000000` ish). The semantic palette contrast ratios are tabulated in §2. The accent's 1.7:1 contrast against white is **insufficient on light backgrounds** — that's the entire reason `accent-strong` exists.

The neutral palette uses ANSI `dim` (SGR 2) rather than explicit gray hex values where possible, so the user's terminal theme can resolve the actual contrast. Terminals that render `dim` as ~50% opacity meet AA against any reasonable theme background.

### Color Independence

- **No information is conveyed by color alone.** Every semantic color is paired with a glyph (`✓ ! ✗ ›`) and a text label.
- The selection cursor `▸` carries the selection meaning by itself — color is a redundant cue.
- `NO_COLOR=1` produces a fully usable interface.

### Keyboard Navigation

All interactive flows are operable with:
- `↑ ↓` (or `k j`) for vertical navigation.
- `← →` (or `h l`) inside text inputs.
- `↵` to confirm, `esc` to cancel, `q` to quit at top level.
- `space` to toggle multi-select.
- `Tab` is not used (it conflicts with shell completion in piped contexts).

Every screen prints its keybinding legend as the last line in `fg-muted`.

### Screen Readers

CLI screen readers (`espeak`, VoiceOver in Terminal) read the visible text in document order. Two implications:

1. **Glyph-first status lines** ensure the screen reader announces the status (✓ "check mark", ✗ "ballot x") before the message body — the user knows the outcome before the detail.
2. **Live regions don't exist.** Spinner frames must not be re-read on every tick — the renderer writes the spinner with a carriage return that overwrites the previous line, and most screen readers do not re-announce overwritten content. Verify with VoiceOver before assuming.

### Motion Sensitivity

Animations are limited to the spinner (12 fps, single glyph, no movement of surrounding text) and progress bar fill (no movement, only character substitution). There is no parallax, scroll, fade, or slide.

`MAESTER_NO_MOTION=1` (and the standard `prefers-reduced-motion`-equivalent we'll borrow, `NO_MOTION=1`) replaces the spinner with a static `›` and a single elapsed-seconds counter that updates on integer-second boundaries:

```
  ›  Resolving dependencies … 3s
```

### Text Accessibility

- The tool never emits text smaller than the terminal cell.
- No artificial line wrapping below 40 cells of width — refuse to render and print a one-line error pointing the user to widen the terminal.
- Line length for prose paragraphs in `--help`: target 72 cells, hard wrap at 80, never longer.

---

## 11. Responsive Design

### Breakpoints

The tool measures terminal columns at draw time (`process.stdout.columns`). Three breakpoints:

| Range | Layout |
|---|---|
| `< 40` cells | Refuse to render interactive screens; print a static error. Non-interactive output (status lines, JSON) still works. |
| `40 – 79` cells | Compact mode: single-column tables, truncate long values aggressively, progress bar width 12 cells, banner suppressed even on `--help`. |
| `≥ 80` cells | Default mode as documented throughout this guide. |

The tool listens for `SIGWINCH` and redraws the current screen on resize (within reason — bulk output that has already scrolled past does not redraw).

### Compact Mode Adaptations

- Banners replaced with a single-line title: `maester · v0.1.0`.
- Tables collapse to a one-row-per-record list rather than columns:
  ```
    api-docs
    ✓ fresh · 2 min ago
  ```
- Boxed summaries lose their box; just the content with a leading title line in `fg-strong`.
- Keybinding legends drop the middle-dot separator and use newlines instead.

### Touch Targets
Not applicable.

### Mobile Navigation
Not applicable. (Mobile terminal apps — Termius, Blink — render with these same constraints. Their narrow widths are handled by the compact-mode breakpoint above.)

---

## 12. Usage Examples

### Initial setup (interactive)

```
                       __
    __ _  ___ ____ ___ / /____ ____
   /  ' \/ _ `/ -_|_-</ __/ -_) __/
  /_/_/_/\_,_/\__/___/\__/\__/_/
  living specs · v0.1.0

  Welcome. Let's set up a new aggregation.

  Choose a source type

  ▸ Git repository
    Google Drive (planned)
    Web URL

  ↑/↓ navigate · ↵ select · esc cancel
```

### Mid-pull progress

```
  Pulling sources

  ⠹  api-docs           cloning…
  ✓  design-tokens      up to date
  ⠼  glossary           fetching refs…

  ▕████████░░░░░░░░░░░░▏  8/20 documents
```

### Completion summary

```
  ┌─ Summary ──────────────────────────────┐
  │ ✓  3 sources pulled                    │
  │ ✓  20 documents aggregated             │
  │ !  1 deprecation warning               │
  └────────────────────────────────────────┘

  · run `maester check` to validate output
```

### Error report

```
  ┏━ Error ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ┃ ✗  Failed to clone api-docs            ┃
  ┃                                         ┃
  ┃    fatal: repository 'git@github.com:   ┃
  ┃    org/api-docs.git' does not exist     ┃
  ┃                                         ┃
  ┃    check the URL and your SSH access    ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  · partial results written to .maester/cache
```

### Empty state

```
  Configured sources

  · no sources configured yet
  · run `maester init` to add one
```

### Do's and Don'ts

**Do**
- Lead status lines with a semantic glyph + space + message.
- Reserve `accent` for the focused/active element on screen.
- Use `dim` (SGR 2) for secondary information instead of choosing a gray hex.
- Render banners only on help, version, and first-run.
- Test rendering in at least one light-background terminal theme.

**Don't**
- Paint a full background fill. Respect the user's terminal background.
- Use multiple accent colors on one screen. One cursor, one accent.
- Animate anything beyond the spinner and progress bar.
- Embed ASCII art in routine command output.
- Use heavy or double box-drawing for non-error content.
- Communicate state with color alone.
- Use color in `--json` output, ever.
