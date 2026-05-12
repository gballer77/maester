import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    pool: "forks",
    passWithNoTests: true,
    testTimeout: 30_000,
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
});
