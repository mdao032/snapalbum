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

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  // Source map upload needs a Sentry auth token (set up with the production deployment).
  sourcemaps: { disable: true },
  telemetry: false,
  webpack: { treeshake: { removeDebugLogging: true } },
});
