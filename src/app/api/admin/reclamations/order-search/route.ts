import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  await requireAdminAction(["OPS"]);
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) {
    return NextResponse.json({ ok: true, data: [] });
  }
  const digits = query.replace(/\D/g, "");
  const needles = Array.from(new Set([query, digits].filter((value) => value.length >= 3)));
  const contains = needles.flatMap((needle) => [
    { number: { contains: needle, mode: "insensitive" as const } },
    {
      fiscalDocuments: {
        some: {
          kind: "SALE" as const,
          status: "ISSUED" as const,
          receiptNumber: { contains: needle, mode: "insensitive" as const },
        },
      },
    },
    {
      fiscal: {
        is: {
          receiptNumber: { contains: needle, mode: "insensitive" as const },
        },
      },
    },
  ]);

  const orders = await db.order.findMany({
    where: {
      status: "ISPORUCENO",
      OR: contains,
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      number: true,
      createdAt: true,
      fiscalDocuments: {
        where: { kind: "SALE", status: "ISSUED" },
        take: 1,
        orderBy: { issuedAt: "desc" },
        select: { receiptNumber: true },
      },
      fiscal: { select: { receiptNumber: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          sku: true,
          name: true,
          qty: true,
          reclamations: { select: { quantity: true } },
        },
      },
    },
  });

  return NextResponse.json({
    ok: true,
    data: orders.map((order) => ({
      number: order.number,
      receiptNumber:
        order.fiscalDocuments[0]?.receiptNumber ??
        order.fiscal?.receiptNumber ??
        null,
      createdAt: order.createdAt.toISOString(),
      items: order.items.flatMap((item) => {
        const claimedQty = item.reclamations.reduce(
          (sum, reclamation) => sum + reclamation.quantity,
          0,
        );
        const availableQty = Math.max(0, item.qty - claimedQty);
        return availableQty > 0
          ? [{ sku: item.sku, name: item.name, availableQty }]
          : [];
      }),
    })),
  });
}
