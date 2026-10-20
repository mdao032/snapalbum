import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The tests share one local database: run files one after the other.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
