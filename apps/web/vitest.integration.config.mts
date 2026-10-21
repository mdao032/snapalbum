import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Integration tests: real network calls to a local S3 emulator (`pnpm storage:start`). */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { SUPABASE_SERVICE_ROLE_KEY: "integration-test" },
  },
});
