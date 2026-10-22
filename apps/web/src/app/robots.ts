import type { MetadataRoute } from "next";
import { clientEnv } from "@/config/env";
import { robotsConfig } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return robotsConfig(clientEnv.NEXT_PUBLIC_SITE_URL);
}
