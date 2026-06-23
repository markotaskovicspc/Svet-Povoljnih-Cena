import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/api/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const limit = Number(searchParams.get("limit") ?? 48);
  try {
    const hits = await searchProducts(q, limit);
    return NextResponse.json({ ok: true, hits });
  } catch (err) {
    console.error("[search]", err);
    return NextResponse.json({ ok: true, hits: [] }, { status: 200 });
  }
}
