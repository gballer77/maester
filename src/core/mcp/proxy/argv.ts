/**
 * Split an args string the way a POSIX shell would tokenize it — single and
 * double quotes, backslash escapes — without ever invoking a shell or expanding
 * anything (`mcp-server add`, architecture §6.17). Throws on an unclosed quote.
 */
export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inToken = false;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined;
      else if (ch === "\\" && i + 1 < input.length && /["\\$`]/.test(input[i + 1] as string)) {
        current += input[++i];
      } else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
    } else if (ch === "\\" && i + 1 < input.length) {
      current += input[++i];
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) args.push(current);
      current = "";
      inToken = false;
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (quote) throw new Error(`unclosed ${quote} quote in arguments`);
  if (inToken) args.push(current);
  return args;
}

/** Render argv for display, quoting only the elements that need it. */
export function formatArgv(argv: readonly string[]): string {
  return argv
    .map((arg) =>
      arg.length > 0 && /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`,
    )
    .join(" ");
}
