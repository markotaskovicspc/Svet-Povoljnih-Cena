import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/helpers/server-only.ts", import.meta.url),
      ),
      "next/server": createRequire(import.meta.url).resolve("next/server"),
    },
  },
  test: {
    setupFiles: ["./tests/helpers/require-test-database.ts"],
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
