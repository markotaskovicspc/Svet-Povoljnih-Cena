import { readShipmentAssignment } from "@/lib/courier/shipment-assignment";
import { isMyGlsReturn } from "@/lib/mygls/return-booking";
import { isCancelledDelivery } from "@/lib/courier/cancelled-delivery";
import { renderPrintHtmlPdf } from "@/lib/pdf/print-html";
import { boxQuantity, myGlsBoxQuantities } from "@/lib/courier/label-quantity";
import { MyGlsPrintLayoutError } from "@/lib/mygls/print-layout";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { downloadMyGlsLabelPdf, MYGLS_PROVIDER } from "@/lib/mygls";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import { xExpressLabelItemSelect } from "@/lib/x-express/article-labels";
import { renderXExpressLabelsHtml } from "@/lib/x-express/labels";
import { fulfillmentPaymentReadiness } from "@/lib/payments/fulfillment-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await ctx.params;
  const shipment = await db.shipment.findUnique({
    where: { id },
    include: {
      pickupBatchLines: { select: { packageNo: true, packedQuantity: true, packedItems: true, providerParcelNumber: true, providerClientReference: true } },
      order: {
        select: {
          number: true,
          status: true,
          cancelledAt: true,
          total: true,
          paymentMethod: true,
          payments: { select: { status: true } },
          shipFirstName: true,
          shipLastName: true,
          shipCompanyName: true,
          shipPhone: true,
          shipStreet: true,
          shipCity: true,
          shipPostalCode: true,
          notes: true,
          items: { select: xExpressLabelItemSelect },
        },
      },
    },
  });
  if (!shipment) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (isCancelledDelivery(shipment)) {
    return NextResponse.json({ ok: false, error: "order_cancelled", message: "Porudžbina je otkazana. Adresnice nisu dostupne za slanje robe; postojeću pošiljku proverite i otkažite kod kurira." }, { status: 409 });
  }
  const paymentReadiness = fulfillmentPaymentReadiness({
    purpose: shipment.purpose,
    paymentMethod: shipment.order.paymentMethod,
    paymentStatuses: shipment.order.payments.map((payment) => payment.status),
  });
  if (!paymentReadiness.ready) {
    return NextResponse.json(
      {
        ok: false,
        error: "payment_not_confirmed",
        message: `Adresnica nije dostupna. ${paymentReadiness.reason}`,
      },
      { status: 409 },
    );
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
      // Before X Express stored direct picking links, the persisted assignment
      // key identified the exact original/deferred/reshipment package group.
      if (!shipment.pickupBatchLines?.length && shipment.purpose === "ORDER_DELIVERY") {
        const assignment = readShipmentAssignment(shipment.rawCreateResponse);
        if (assignment) {
          shipment.pickupBatchLines = await db.pickupBatchLine.findMany({
            where: {
              orderId: shipment.orderId,
              lineGroupKey: assignment.assignmentKey ?? `order:${shipment.orderId}:X_EXPRESS`,
              deferredAt: null,
              batch: { provider: X_EXPRESS_PROVIDER },
            },
            orderBy: { packageNo: "asc" },
            select: { packageNo: true, packedQuantity: true, packedItems: true, providerParcelNumber: true, providerClientReference: true },
          });
        }
      }
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
    return new NextResponse(new Uint8Array(await renderPrintHtmlPdf(html)), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="x-express-adresnica-${shipment.trackingNo}.pdf"`,
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

  let pdf: Buffer;
  try {
    const quantities = shipment.pickupBatchLines?.length
      ? shipment.pickupBatchLines.map(line => ({ quantity: boxQuantity(line), parcelNumber: line.providerParcelNumber, clientReference: line.providerClientReference }))
      : myGlsBoxQuantities(shipment.rawCreateResponse);
    pdf = await downloadMyGlsLabelPdf(shipment.labelObjectKey, quantities, isMyGlsReturn(shipment));
  } catch (error) {
    if (!(error instanceof MyGlsPrintLayoutError)) throw error;
    return NextResponse.json({ ok: false, error: "mygls_label_invalid", message: error.message }, { status: 409 });
  }
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": shipment.labelMimeType ?? "application/pdf",
      "content-disposition": `inline; filename="mygls-${shipment.trackingNo ?? id}.pdf"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-courier-label-source": "mygls-provider-pdf",
    },
  });
}
