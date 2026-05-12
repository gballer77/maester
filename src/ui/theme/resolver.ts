import { Chalk, type ChalkInstance } from "chalk";
import { type ColorDepth, type PaletteToken, type Theme, resolveToken } from "./tokens.js";

const COLOR_LEVEL_BY_DEPTH: Record<ColorDepth, 0 | 1 | 2 | 3> = {
  none: 0,
  ansi16: 1,
  ansi256: 2,
  truecolor: 3,
};

export type Painter = {
  token: (token: PaletteToken, text: string) => string;
  bold: (text: string) => string;
  dim: (text: string) => string;
  italic: (text: string) => string;
  underline: (text: string) => string;
  inverse: (text: string) => string;
  raw: (text: string) => string;
};

export function createPainter(depth: ColorDepth, theme: Theme): Painter {
  const level = COLOR_LEVEL_BY_DEPTH[depth];
  const instance: ChalkInstance = new Chalk({ level });

  function paint(token: PaletteToken, text: string): string {
    if (level === 0) return text;
    const resolved = resolveToken(token, theme);
    if (level >= 3) {
      return instance.hex(resolved.hex)(text);
    }
    if (level === 2) {
      return instance.ansi256(resolved.ansi256)(text);
    }
    const named = resolved.ansi16 as keyof ChalkInstance;
    const fn = instance[named];
    if (typeof fn === "function") {
      return (fn as (s: string) => string)(text);
    }
    return text;
  }

  return {
    token: paint,
    bold: (text) => (level === 0 ? text : instance.bold(text)),
    dim: (text) => (level === 0 ? text : instance.dim(text)),
    italic: (text) => (level === 0 ? text : instance.italic(text)),
    underline: (text) => (level === 0 ? text : instance.underline(text)),
    inverse: (text) => (level === 0 ? text : instance.inverse(text)),
    raw: (text) => text,
  };
}
