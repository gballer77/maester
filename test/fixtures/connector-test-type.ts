import { z } from "zod";
import { ConnectorError } from "../../src/core/connectors/errors.js";
import { type ConnectorType, defineConnectorOperation } from "../../src/core/connectors/types.js";

/**
 * Test-only ConnectorType used to exercise the framework end-to-end without
 * depending on any concrete production connector. The type id is namespaced
 * with `__test__` so production code is unlikely to collide with it.
 *
 * Operations:
 *  - `echo` — returns `{ said: <message> }` unmodified.
 *  - `fail` — always throws `ConnectorError("remote-error", ...)`. Used to
 *    exercise the error envelope path.
 */
export const TEST_CONNECTOR_TYPE_ID = "__test_echo__";

const configSchema = z
  .object({
    prefix: z.string().optional(),
  })
  .strict();
type TestConfig = z.infer<typeof configSchema>;

const echoSchema = z
  .object({
    message: z.string().min(1),
  })
  .strict();

const failSchema = z.object({}).strict();

export const testConnectorType: ConnectorType<TestConfig> = {
  id: TEST_CONNECTOR_TYPE_ID,
  label: "Test Echo",
  configSchema,
  operations: {
    echo: defineConnectorOperation<TestConfig, z.infer<typeof echoSchema>, { said: string }>({
      name: "echo",
      argsSchema: echoSchema,
      dataSchemaVersion: 1,
      handler: async (args, ctx) => {
        const said = ctx.config.prefix ? `${ctx.config.prefix}: ${args.message}` : args.message;
        return { data: { said } };
      },
    }),
    fail: defineConnectorOperation<TestConfig, z.infer<typeof failSchema>, never>({
      name: "fail",
      argsSchema: failSchema,
      dataSchemaVersion: 1,
      handler: async () => {
        throw new ConnectorError("remote-error", "test failure", { kind: "test" });
      },
    }),
    boom: defineConnectorOperation<TestConfig, z.infer<typeof failSchema>, never>({
      name: "boom",
      argsSchema: failSchema,
      dataSchemaVersion: 1,
      handler: async () => {
        throw new Error("unexpected internal throw");
      },
    }),
  },
  describeTool: (operation, resolvedConfig) =>
    `Test echo operation '${operation.name}' (prefix=${resolvedConfig.prefix ?? "<none>"}).`,
};
