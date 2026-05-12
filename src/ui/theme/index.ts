import { type DetectOptions, type TerminalCapabilities, detect } from "./detect.js";
import { type GlyphRole, glyph as glyphFor, spinnerFrames as spinnerFramesFor } from "./glyphs.js";
import { type Painter, createPainter } from "./resolver.js";
import type { PaletteToken } from "./tokens.js";

export type Theming = {
  caps: TerminalCapabilities;
  painter: Painter;
  glyph: (role: GlyphRole) => { text: string; token: PaletteToken | undefined };
  paintedGlyph: (role: GlyphRole) => string;
  spinnerFrames: () => readonly string[];
};

export function createTheming(opts: DetectOptions = {}): Theming {
  const caps = detect(opts);
  const painter = createPainter(caps.colorDepth, caps.theme);
  return {
    caps,
    painter,
    glyph: (role) => glyphFor(role, caps.unicode),
    paintedGlyph: (role) => {
      const g = glyphFor(role, caps.unicode);
      return g.token ? painter.token(g.token, g.text) : g.text;
    },
    spinnerFrames: () => spinnerFramesFor(caps.unicode),
  };
}

export type { TerminalCapabilities, DetectOptions } from "./detect.js";
export type { Painter } from "./resolver.js";
export type { GlyphRole } from "./glyphs.js";
export { PALETTE, SPACING, WIDTH, resolveToken } from "./tokens.js";
export type { PaletteToken, Theme, ColorDepth, ResolvedToken } from "./tokens.js";
