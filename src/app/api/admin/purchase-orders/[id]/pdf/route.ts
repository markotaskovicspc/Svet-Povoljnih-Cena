import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { buildPurchaseOrderPdf } from "@/lib/admin/po-pdf";
import { purchaseOrderAttachmentFilename } from "@/lib/admin/purchase-order-email";
import { purchaseOrderSendDate } from "@/lib/admin/purchase-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const previewForSending =
    new URL(request.url).searchParams.get("mode") === "send-preview";
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      loadingLocation: true,
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          product: {
            select: {
              media: {
                take: 1,
                orderBy: { order: "asc" },
                select: { url: true },
              },
            },
          },
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const pdf = await buildPurchaseOrderPdf({
    ...order,
    orderDate: previewForSending ? purchaseOrderSendDate() : order.orderDate,
    totalPrice: Number(order.totalPrice),
    totalVolume: Number(order.totalVolume ?? 0),
    items: order.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      supplierProductName: item.supplierProductName,
      attributes: item.attributes,
      pattern: item.pattern,
      packQty: item.packQty,
      qty: item.qty,
      purchasePrice: Number(item.purchasePrice),
      currency: item.currency,
      totalVolume: Number(item.totalVolume ?? 0),
      certificates: item.certificates,
      barcode: item.barcode,
      imageUrl: item.product?.media[0]?.url ?? null,
    })),
  });
  const filename = purchaseOrderAttachmentFilename(order.number);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "content-length": String(pdf.byteLength),
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
