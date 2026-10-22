import type { MetadataRoute } from "next";
import { clientEnv } from "@/config/env";
import { sitemapEntries } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(clientEnv.NEXT_PUBLIC_SITE_URL);
}
