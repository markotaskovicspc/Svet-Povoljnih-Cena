import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/checkout", "/nalog", "/korpa"],
    },
    sitemap: `${BRAND.url}/sitemap.xml`,
    host: BRAND.url,
  };
}
