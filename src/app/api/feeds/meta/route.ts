import { loadFeedProducts, buildMetaCsv } from "@/lib/feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4G — Public Meta (Facebook/Instagram) Catalog CSV feed.
 *
 *   GET /api/feeds/meta → text/csv
 *
 * Point Meta Commerce Manager → Data Feeds at this URL with a daily
 * pull schedule.
 */
export async function GET() {
  const products = await loadFeedProducts("meta");
  const csv = buildMetaCsv(products);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="meta-catalog.csv"',
      "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400",
      "X-Feed-Item-Count": String(products.length),
    },
  });
}
