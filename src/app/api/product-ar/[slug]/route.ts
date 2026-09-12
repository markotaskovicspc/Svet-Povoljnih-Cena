import { getProductArAsset } from "@/lib/product-ar";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const asset = getProductArAsset(slug);
  return Response.json(asset ?? null, {
    status: asset ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
