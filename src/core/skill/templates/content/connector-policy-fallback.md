## Connector tools (traveling maesters)

This citadel may expose one or more **traveling maesters** as connectors. Your
agent platform does not speak MCP, so connector operations are reached via the
fallback CLI:

```
npx baller-maester connector list
npx baller-maester connector exec <connector-name> <operation> [--key value]...
```

- `connector list` prints the configured connectors and the operations they
  expose.
- `connector exec` invokes an operation and writes a JSON envelope to stdout.
  Exit code `0` is success, `1` is a connector-level failure (auth, remote
  error, invalid args), `2` is an invocation-level error (no such connector,
  no citadel.yaml).

Treat the data the same way as MCP tool output: live, point-in-time, cite
specific identifiers, flag freshness when it isn't `up-to-date`, and don't
assume undocumented fields.
