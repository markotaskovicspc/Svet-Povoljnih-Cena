import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  const privatePaths = ["/admin", "/api", "/checkout", "/nalog", "/korpa"];

  return {
    rules: [
      {
        // Anthropic supports Crawl-delay. One request per second preserves AI
        // discovery while preventing another high-CPU product-catalog burst.
        userAgent: "ClaudeBot",
        allow: "/",
        disallow: privatePaths,
        crawlDelay: 1,
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: privatePaths,
      },
    ],
    sitemap: `${BRAND.url}/sitemap.xml`,
    host: BRAND.url,
  };
}
