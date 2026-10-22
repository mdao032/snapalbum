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
    // QR code and PDF generation are slow under coverage instrumentation.
    testTimeout: 20_000,
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
      // `server/storage.ts` talks to S3: its tests are the integration tests (`pnpm test:integration`).
      exclude: [
        "**/*.test.*",
        "src/server/storage.ts",
        // Written against the real database and a clock we move: `tests/integration/lifecycle.test.ts`
        // runs expiry, purge, clean-up, reminders, recap and every e-mail once (SPEC 9.2, 14).
        "src/server/lifecycle.ts",
        "src/server/notifications.ts",
        "src/server/email/send.ts",
        "src/lib/upload/browser-io.ts",
        "src/lib/upload/prepare-image.ts",
        "src/lib/upload/prepare.worker.ts",
        "src/lib/upload/surface.ts",
        "src/lib/upload/orientation-probe.ts",
        "src/lib/upload/heic.ts",
      ],
      // The files of the preparation (canvas, decoding, Web Worker, HEIC, XHR) need a real browser:
      // `tests/e2e/upload-prepare.spec.ts` runs every fixture through them on four browser profiles.
      // `prepare-client.ts` (worker protocol and fallbacks) is unit tested with a fake worker.
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
