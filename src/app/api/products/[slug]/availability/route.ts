import { NextResponse } from "next/server";
import { getProductBySlug } from "@/lib/api/catalog";
import { getProductAvailability } from "@/lib/product-availability";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 15;

// Keep the build fast, then create and reuse each small JSON response on its
// first request. Next.js ISR also serves the previous response while it
// refreshes, so a burst cannot fan out into one database query per visitor.
export function generateStaticParams() {
  return [];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return NextResponse.json(
      { error: "not_found" },
      {
        status: 404,
        headers: { "Cache-Control": "public, max-age=0, s-maxage=15" },
      },
    );
  }

  return NextResponse.json(
    {
      availability: getProductAvailability(product),
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        // Availability is public and contains no exact supplier quantity.
        // The short edge TTL absorbs bursts while checkout remains authoritative.
        "Cache-Control":
          "public, max-age=0, s-maxage=15, stale-while-revalidate=15",
      },
    },
  );
}
