import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "md-as-text",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".md")) {
          const filePath = id.startsWith("file:") ? fileURLToPath(id) : id;
          const content = readFileSync(filePath, "utf8");
          return `export default ${JSON.stringify(content)};`;
        }
        return null;
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    pool: "forks",
    passWithNoTests: true,
    testTimeout: 30_000,
    globalSetup: ["./test/setup/global-build.ts"],
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
});
