import type { PaletteToken } from "./tokens.js";

export type GlyphRole =
  | "cursor"
  | "expand"
  | "collapse"
  | "checkOff"
  | "checkOn"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "bullet"
  | "ellipsis"
  | "separator"
  | "progressFill"
  | "progressTrack";

type GlyphDef = {
  unicode: string;
  ascii: string;
  token: PaletteToken | undefined;
};

const CATALOG: Record<GlyphRole, GlyphDef> = {
  cursor: { unicode: "▸", ascii: ">", token: "accent" },
  expand: { unicode: "▾", ascii: "v", token: "accent" },
  collapse: { unicode: "▴", ascii: "^", token: "accent" },
  checkOff: { unicode: "◯", ascii: "[ ]", token: "fgMuted" },
  checkOn: { unicode: "◉", ascii: "[x]", token: "accent" },
  success: { unicode: "✓", ascii: "[ok]", token: "success" },
  warning: { unicode: "!", ascii: "!", token: "warning" },
  error: { unicode: "✗", ascii: "[X]", token: "error" },
  info: { unicode: "›", ascii: ">", token: "info" },
  bullet: { unicode: "·", ascii: "-", token: "fgMuted" },
  ellipsis: { unicode: "…", ascii: "...", token: undefined },
  separator: { unicode: " · ", ascii: " - ", token: "fgMuted" },
  progressFill: { unicode: "█", ascii: "#", token: "accent" },
  progressTrack: { unicode: "░", ascii: ".", token: "fgFaint" },
};

export const SPINNER_FRAMES_UNICODE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const SPINNER_FRAMES_ASCII = ["|", "/", "-", "\\"] as const;

export function glyph(
  role: GlyphRole,
  unicode: boolean,
): { text: string; token: PaletteToken | undefined } {
  const def = CATALOG[role];
  return { text: unicode ? def.unicode : def.ascii, token: def.token };
}

export function spinnerFrames(unicode: boolean): readonly string[] {
  return unicode ? SPINNER_FRAMES_UNICODE : SPINNER_FRAMES_ASCII;
}
