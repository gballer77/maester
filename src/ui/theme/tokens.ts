export const PALETTE = {
  accent: { hex: "#7CE7C7", ansi256: 121 },
  accentStrong: { hex: "#2BA88A", ansi256: 36 },
  accentAlt: { hex: "#B197FC", ansi256: 141 },
  success: { hex: "#6ED49B", ansi256: 78 },
  warning: { hex: "#F0C674", ansi256: 222 },
  error: { hex: "#FF6B6B", ansi256: 203 },
  info: { hex: "#74A9F0", ansi256: 111 },
  fgMuted: { hex: "#8A8A8A", ansi256: 245 },
  fgFaint: { hex: "#5A5A5A", ansi256: 240 },
} as const;

export type PaletteToken = keyof typeof PALETTE;

export const SPACING = {
  xs: 1,
  sm: 2,
  md: 4,
  lg: 1,
  xl: 2,
} as const;

export const WIDTH = {
  proseTarget: 72,
  proseHardWrap: 80,
  panelMax: 100,
  minimum: 40,
  compactCeiling: 79,
  full: 80,
} as const;

export type Theme = "dark" | "light";

export type ColorDepth = "truecolor" | "ansi256" | "ansi16" | "none";

export type ResolvedToken = {
  hex: string;
  ansi256: number;
  ansi16: string;
};

const ANSI16_BY_TOKEN: Record<PaletteToken, string> = {
  accent: "cyanBright",
  accentStrong: "cyan",
  accentAlt: "magentaBright",
  success: "greenBright",
  warning: "yellow",
  error: "redBright",
  info: "blueBright",
  fgMuted: "gray",
  fgFaint: "gray",
};

export function resolveToken(token: PaletteToken, theme: Theme): ResolvedToken {
  const effective = token === "accent" && theme === "light" ? "accentStrong" : token;
  const palette = PALETTE[effective];
  return {
    hex: palette.hex,
    ansi256: palette.ansi256,
    ansi16: ANSI16_BY_TOKEN[effective] ?? "white",
  };
}
