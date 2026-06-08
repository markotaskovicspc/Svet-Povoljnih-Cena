import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), 20);
  const items = await db.courierLocationCode.findMany({
    where: {
      provider: X_EXPRESS_PROVIDER,
      active: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { settlement: { contains: q, mode: "insensitive" } },
        { postalCode: { startsWith: q } },
      ],
    },
    orderBy: [{ postalCode: "asc" }, { name: "asc" }],
    take: limit,
    select: {
      code: true,
      name: true,
      postalCode: true,
      city: true,
      settlement: true,
    },
  });

  return NextResponse.json({
    items: items.map((item) => ({
      code: item.code,
      name: item.settlement ?? item.city ?? item.name,
      postalCode: item.postalCode ?? "",
    })),
  });
}
