import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { buildPurchaseOrderPdf } from "@/lib/admin/po-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: { supplier: true, items: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const pdf = buildPurchaseOrderPdf({
    ...order,
    freightCost: Number(order.freightCost),
    totalPrice: Number(order.totalPrice),
    items: order.items.map((item) => ({
      ...item,
      purchasePrice: Number(item.purchasePrice),
    })),
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="porudzbenica-${order.number.replaceAll("/", "-")}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
