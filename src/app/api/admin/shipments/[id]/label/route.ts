import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { downloadMyGlsLabelPdf, MYGLS_PROVIDER } from "@/lib/mygls";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import { renderXExpressLabelsHtml } from "@/lib/x-express/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await ctx.params;
  const shipment = await db.shipment.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          number: true,
          total: true,
          paymentMethod: true,
          shipFirstName: true,
          shipLastName: true,
          shipPhone: true,
          shipStreet: true,
          shipCity: true,
          shipPostalCode: true,
          notes: true,
          items: { select: { name: true, qty: true } },
        },
      },
    },
  });
  if (!shipment) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (shipment.provider === X_EXPRESS_PROVIDER) {
    const html = renderXExpressLabelsHtml(shipment);
    return new NextResponse(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="x-express-${shipment.trackingNo ?? id}.html"`,
        "cache-control": "private, no-store",
      },
    });
  }
  if (shipment.provider !== MYGLS_PROVIDER || !shipment.labelObjectKey) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const pdf = await downloadMyGlsLabelPdf(shipment.labelObjectKey);
  return new NextResponse(pdf, {
    headers: {
      "content-type": shipment.labelMimeType ?? "application/pdf",
      "content-disposition": `inline; filename="mygls-${shipment.trackingNo ?? id}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
