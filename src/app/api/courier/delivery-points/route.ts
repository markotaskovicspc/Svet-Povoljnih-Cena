import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MYGLS_PROVIDER } from "@/lib/mygls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), 20);
  const items = await db.courierDeliveryPoint.findMany({
    where: {
      provider: MYGLS_PROVIDER,
      active: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { street: { contains: q, mode: "insensitive" } },
        { postalCode: { startsWith: q } },
        { code: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ city: "asc" }, { name: "asc" }],
    take: limit,
    select: {
      code: true,
      name: true,
      type: true,
      street: true,
      city: true,
      postalCode: true,
    },
  });

  return NextResponse.json({
    items: items.map((item) => ({
      code: item.code,
      name: item.name,
      type: item.type,
      street: item.street,
      city: item.city,
      postalCode: item.postalCode,
      label: [item.name, item.street, item.postalCode, item.city]
        .filter(Boolean)
        .join(", "),
    })),
  });
}
