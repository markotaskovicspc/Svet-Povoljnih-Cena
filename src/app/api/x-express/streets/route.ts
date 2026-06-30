import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const townId = Number(url.searchParams.get("townId"));
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!Number.isInteger(townId) || townId <= 0 || q.length < 2) {
    return NextResponse.json({ items: [] });
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), 20);
  const normalized = q.toLocaleLowerCase("sr-Latn-RS");
  const items = await db.xExpressStreet.findMany({
    where: {
      townId,
      active: true,
      deleted: false,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { simpleName: { contains: normalized, mode: "insensitive" } },
      ],
    },
    orderBy: [{ official: "desc" }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      streetId: true,
      name: true,
      simpleName: true,
      official: true,
    },
  });

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      streetId: item.streetId,
      name: item.name,
      simpleName: item.simpleName,
      official: item.official,
    })),
  });
}
