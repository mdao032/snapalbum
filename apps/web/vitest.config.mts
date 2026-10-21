import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components; stub it for unit tests.
      "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/unit/setup.ts"],
    // next-intl imports `next/navigation` without an extension: let Vite resolve it.
    server: { deps: { inline: [/next-intl/] } },
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    env: {
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_SHORT_LINK_BASE: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    },
    coverage: {
      provider: "v8",
      // Business logic folders (NF-042): the 80 % threshold applies to them.
      include: ["src/lib/**/*.{ts,tsx}", "src/server/**/*.ts", "src/config/**/*.ts"],
      exclude: ["**/*.test.*"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
