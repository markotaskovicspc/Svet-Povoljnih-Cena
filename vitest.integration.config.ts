import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/helpers/server-only.ts", import.meta.url),
      ),
      "next/server": fileURLToPath(
        new URL("../../../node_modules/next/server.js", import.meta.url),
      ),
    },
  },
  test: {
    setupFiles: ["./tests/helpers/require-test-database.ts"],
    environment: "node",
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
