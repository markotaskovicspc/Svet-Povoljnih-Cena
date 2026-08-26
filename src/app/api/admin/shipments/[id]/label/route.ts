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
          shipCompanyName: true,
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
    if (shipment.status === "FAILED" || !shipment.trackingNo) {
      return NextResponse.json(
        {
          ok: false,
          error: "x_express_label_unavailable",
          message: "X Express adresnica nije ispravno pripremljena.",
        },
        { status: 409 },
      );
    }
    let html: string;
    try {
      html = renderXExpressLabelsHtml(shipment);
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "x_express_label_invalid",
          message:
            error instanceof Error
              ? error.message
              : "X Express adresnica nije ispravna.",
        },
        { status: 409 },
      );
    }
    return new NextResponse(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="x-express-adresnica-${shipment.trackingNo}.html"`,
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
        "x-courier-label-source": "erp-x-express-api-data",
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
      "x-content-type-options": "nosniff",
      "x-courier-label-source": "mygls-provider-pdf",
    },
  });
}
