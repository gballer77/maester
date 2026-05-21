/**
 * Resolve the command line that a host MCP registration should embed to launch
 * `maester mcp`. We use the standard MCP-ecosystem convention
 * (`npx -y baller-maester mcp`) so the registration is portable across machines
 * and self-updates on the next `npm publish`:
 *
 *   - Works for users who `npm i -g baller-maester` (npx finds the global)
 *   - Works for users who never install at all (npx pulls from the registry on
 *     first spawn and caches for subsequent calls)
 *   - Works after a `baller-maester` version bump without re-running
 *     `maester connector refresh` (npx resolves the latest cached version)
 *
 * The `-y` flag skips npx's first-run confirmation, which would otherwise
 * stall the MCP handshake.
 *
 * Note: during local pre-publish development (e.g. when iterating via
 * `pnpm link --global`), this default emits a config that won't work because
 * `baller-maester` isn't on the registry yet. Manually swap to
 * `command = "maester"` (bare bin name) for local testing until 0.4.0 ships.
 */
export type MaesterLaunchCommand = { command: string; args: string[] };

export function resolveMaesterLaunchCommand(): MaesterLaunchCommand {
  return { command: "npx", args: ["-y", "baller-maester", "mcp"] };
}
