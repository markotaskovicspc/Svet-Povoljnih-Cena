import { buildTiktokCsv, loadFeedProducts } from "@/lib/feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const products = await loadFeedProducts("tiktok");
  const csv = buildTiktokCsv(products);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="tiktok-catalog.csv"',
      "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400",
      "X-Feed-Item-Count": String(products.length),
    },
  });
}
