import { WIDTH } from "./theme/tokens.js";

export type WidthMode = "tiny" | "compact" | "default";

export type WidthInfo = {
  columns: number;
  mode: WidthMode;
};

const DEFAULT_FALLBACK = 80;

export function readColumns(stream: NodeJS.WriteStream = process.stdout): number {
  if (typeof stream.columns === "number" && stream.columns > 0) return stream.columns;
  return DEFAULT_FALLBACK;
}

export function classifyWidth(columns: number): WidthMode {
  if (columns < WIDTH.minimum) return "tiny";
  if (columns <= WIDTH.compactCeiling) return "compact";
  return "default";
}

export function readWidth(stream: NodeJS.WriteStream = process.stdout): WidthInfo {
  const columns = readColumns(stream);
  return { columns, mode: classifyWidth(columns) };
}

export function effectivePanelWidth(columns: number): number {
  return Math.min(columns, WIDTH.panelMax);
}

export function effectiveProseWidth(columns: number): number {
  return Math.min(columns, WIDTH.proseHardWrap);
}
