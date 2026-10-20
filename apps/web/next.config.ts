import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `@snapalbum/shared` ships TypeScript sources, compiled by Next.js.
  transpilePackages: ["@snapalbum/shared"],
  poweredByHeader: false,
  // Do not let Next.js write an AGENTS.md file into the repository.
  agentRules: false,
};

// Source maps are uploaded to Sentry only when a build has an auth token (Vercel production).
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(withNextIntl(nextConfig), {
  org: "ywa-d5",
  project: "snapalbum",
  // Keep Sentry build messages visible in the deployment log.
  silent: false,
  // A Sentry problem (token, region, network) must never block a deployment.
  errorHandler: (error) => console.warn(`[sentry] build step skipped: ${error.message}`),
  sourcemaps: { disable: !uploadSourceMaps },
  telemetry: false,
  webpack: { treeshake: { removeDebugLogging: true } },
});
