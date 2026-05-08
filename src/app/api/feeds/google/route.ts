import { loadFeedProducts, buildGoogleMerchantXml } from "@/lib/feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4G — Public Google Merchant Center XML feed.
 *
 *   GET /api/feeds/google → application/xml
 *
 * Configure this URL in Merchant Center → Products → Feeds with a
 * fetch schedule of at least once per day. The response is cached on
 * the CDN edge for 30 minutes (s-maxage) with stale-while-revalidate
 * so a brief DB blip never starves Google's crawler.
 */
export async function GET() {
  const products = await loadFeedProducts("google");
  const xml = buildGoogleMerchantXml(products);
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400",
      "X-Feed-Item-Count": String(products.length),
    },
  });
}
