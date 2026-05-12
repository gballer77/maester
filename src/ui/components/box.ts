import boxen, { type Options as BoxenOptions } from "boxen";
import type { Theming } from "../theme/index.js";
import { effectivePanelWidth } from "../width.js";

export type BoxStyle = "light" | "heavy" | "rounded";

export type BoxOptions = {
  title?: string;
  style?: BoxStyle;
  width?: number;
  isTTY?: boolean;
};

const STYLE_MAP: Record<BoxStyle, "single" | "bold" | "round"> = {
  light: "single",
  heavy: "bold",
  rounded: "round",
};

export function renderBox(theming: Theming, content: string, opts: BoxOptions = {}): string {
  const style = opts.style ?? "light";
  const isTTY = opts.isTTY ?? theming.caps.isTTY;

  if (!isTTY || theming.caps.colorDepth === "none") {
    return renderPlainBox(content, opts.title);
  }

  const columns = theming.caps.isTTY ? (process.stdout.columns ?? 80) : 80;
  const width = opts.width
    ? Math.max(20, opts.width)
    : Math.max(20, effectivePanelWidth(columns) - 2);

  const base: BoxenOptions = {
    borderStyle: STYLE_MAP[style],
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: 0,
    width,
    dimBorder: style === "light",
  };
  const withTitle: BoxenOptions =
    opts.title === undefined ? base : { ...base, title: opts.title, titleAlignment: "left" };

  return boxen(content, withTitle);
}

function renderPlainBox(content: string, title?: string): string {
  const head = title ? `--- ${title} ---` : "---";
  return `${head}\n${content}\n---`;
}
