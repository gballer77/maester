import Table from "cli-table3";
import type { Theming } from "../theme/index.js";

export type TableColumn = {
  header: string;
  key: string;
};

export type TableRow = Record<string, string>;

export type TableOptions = {
  columns: TableColumn[];
  rows: TableRow[];
};

export function renderTable(theming: Theming, opts: TableOptions): string {
  const head = opts.columns.map((c) => theming.painter.bold(c.header));
  const table = new Table({
    head,
    chars: tableChars(),
    style: { head: [], border: [], "padding-left": 1, "padding-right": 1 },
  });
  for (const row of opts.rows) {
    table.push(opts.columns.map((c) => row[c.key] ?? ""));
  }
  return table.toString();
}

function tableChars(): NonNullable<Table.TableConstructorOptions["chars"]> {
  return {
    top: "─",
    "top-mid": "",
    "top-left": "",
    "top-right": "",
    bottom: "─",
    "bottom-mid": "",
    "bottom-left": "",
    "bottom-right": "",
    left: "",
    "left-mid": "",
    mid: "",
    "mid-mid": "",
    right: "",
    "right-mid": "",
    middle: "  ",
  };
}
