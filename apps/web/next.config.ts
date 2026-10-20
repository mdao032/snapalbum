import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `@snapalbum/shared` ships TypeScript sources, compiled by Next.js.
  transpilePackages: ["@snapalbum/shared"],
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
