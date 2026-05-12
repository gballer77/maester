import type { ColorDepth, Theme } from "./tokens.js";

export type TerminalEnv = {
  NO_COLOR?: string | undefined;
  FORCE_COLOR?: string | undefined;
  COLORTERM?: string | undefined;
  TERM?: string | undefined;
  COLORFGBG?: string | undefined;
  MAESTER_THEME?: string | undefined;
  MAESTER_NO_MOTION?: string | undefined;
  MAESTER_NO_WELCOME?: string | undefined;
  LC_CTYPE?: string | undefined;
  LANG?: string | undefined;
};

export type TerminalCapabilities = {
  isTTY: boolean;
  colorDepth: ColorDepth;
  theme: Theme;
  unicode: boolean;
  motion: boolean;
};

export type DetectOptions = {
  env?: TerminalEnv;
  isTTY?: boolean;
  unicodeOverride?: boolean;
  themeOverride?: Theme;
  forceColor?: "always" | "never" | "auto";
};

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

export function detectColorDepth(env: TerminalEnv, isTTY: boolean): ColorDepth {
  if (isNonEmpty(env.NO_COLOR)) {
    return "none";
  }
  if (isNonEmpty(env.FORCE_COLOR)) {
    const v = env.FORCE_COLOR;
    if (v === "0" || v === "false") return "none";
    if (v === "1") return "ansi16";
    if (v === "2") return "ansi256";
    if (v === "3" || v === "true" || v === "") return "truecolor";
    return "truecolor";
  }
  if (!isTTY) {
    return "none";
  }
  const colorTerm = env.COLORTERM ?? "";
  if (colorTerm === "truecolor" || colorTerm === "24bit") {
    return "truecolor";
  }
  const term = env.TERM ?? "";
  if (term.includes("truecolor") || term.includes("24bit")) {
    return "truecolor";
  }
  if (term.includes("256color")) {
    return "ansi256";
  }
  if (term === "dumb" || term === "") {
    return "none";
  }
  return "ansi16";
}

export function detectTheme(env: TerminalEnv, override?: Theme): Theme {
  if (override) return override;
  const fromEnv = env.MAESTER_THEME?.toLowerCase();
  if (fromEnv === "light" || fromEnv === "dark") return fromEnv;
  const colorFgBg = env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(";");
    const bg = parts.length > 0 ? parts[parts.length - 1] : undefined;
    if (bg !== undefined && /^\d+$/.test(bg)) {
      const idx = Number(bg);
      if (idx >= 7 && idx <= 15) return "light";
    }
  }
  return "dark";
}

export function detectUnicode(env: TerminalEnv, override?: boolean): boolean {
  if (override !== undefined) return override;
  const lcCtype = env.LC_CTYPE ?? "";
  const lang = env.LANG ?? "";
  return /UTF-?8/i.test(lcCtype) || /UTF-?8/i.test(lang) || process.platform === "darwin";
}

export function detectMotion(env: TerminalEnv & { NO_MOTION?: string | undefined }): boolean {
  return !isNonEmpty(env.MAESTER_NO_MOTION) && !isNonEmpty(env.NO_MOTION);
}

export function detect(opts: DetectOptions = {}): TerminalCapabilities {
  const env = opts.env ?? (process.env as TerminalEnv);
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  const force = opts.forceColor ?? "auto";
  let colorDepth: ColorDepth;
  if (force === "never") colorDepth = "none";
  else if (force === "always")
    colorDepth = detectColorDepth({ ...env, FORCE_COLOR: env.FORCE_COLOR ?? "3" }, isTTY);
  else colorDepth = detectColorDepth(env, isTTY);
  return {
    isTTY,
    colorDepth,
    theme: detectTheme(env, opts.themeOverride),
    unicode: detectUnicode(env, opts.unicodeOverride),
    motion: detectMotion(env),
  };
}
