import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), 20);
  const exactItems = await db.xExpressTown.findMany({
    where: {
      active: true,
      name: { equals: q, mode: "insensitive" },
    },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      displayName: true,
      postalCode: true,
      municipalityId: true,
    },
  });
  const items = await db.xExpressTown.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { postalCode: { startsWith: q } },
      ],
    },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      displayName: true,
      postalCode: true,
      municipalityId: true,
    },
  });

  return NextResponse.json({
    items: (exactItems.length ? exactItems : items).map((item) => ({
      code: String(item.id),
      townId: item.id,
      municipalityId: item.municipalityId,
      name: item.name,
      displayName: item.displayName ?? item.name,
      postalCode: item.postalCode ?? "",
    })),
  });
}
