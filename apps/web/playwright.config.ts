import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const isCI = Boolean(process.env.CI);
const STORAGE_ENDPOINT = process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100";
const STORAGE_PROXY = "http://127.0.0.1:9101";
const STORAGE_BUCKET = "snapalbum-e2e";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // next-intl detects the browser language: tests run as a French visitor unless they say otherwise.
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    // Entrance animations would otherwise be mid-fade when axe measures color contrast.
    reducedMotion: "reduce",
    trace: "on-first-retry",
  },
  // Chromium and WebKit on desktop, plus the two mobile profiles required by NF-020.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "iphone-13", use: { ...devices["iPhone 13"] } },
    { name: "pixel-7", use: { ...devices["Pixel 7"] } },
  ],
  // Serves the production build: run `pnpm build` first (turbo does it for `pnpm test:e2e`).
  webServer: [
    {
      command: "node tests/e2e/storage-cors-proxy.mjs",
      port: 9101,
      reuseExistingServer: !isCI,
      env: { S3_TEST_ENDPOINT: STORAGE_ENDPOINT },
    },
    {
      command: `pnpm exec next start -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      // Uploads go to the local S3 emulator (`pnpm storage:start`), never to a real bucket.
      env: {
        R2_ENDPOINT: STORAGE_PROXY,
        R2_ACCESS_KEY_ID: "snapalbum",
        R2_SECRET_ACCESS_KEY: "snapalbum-secret",
        R2_BUCKET: STORAGE_BUCKET,
      },
    },
  ],
});
