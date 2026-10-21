import type { MetadataRoute } from "next";
import { BRAND_SITE_URL } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin"],
    },
    sitemap: `${BRAND_SITE_URL}/sitemap.xml`,
  };
}
