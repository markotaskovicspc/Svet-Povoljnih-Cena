import { NextResponse } from "next/server";
import type { Prisma, ShipmentPurpose } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { readShipmentAssignment } from "@/lib/courier/shipment-assignment";
import { db } from "@/lib/db";
import {
  downloadMyGlsLabelPdf,
  MYGLS_PROVIDER,
} from "@/lib/mygls";
import { usableMyGlsLabelWhere } from "@/lib/mygls/labels";
import { mergePdfDocuments } from "@/lib/pdf/merge";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import { renderXExpressBatchLabelsHtml } from "@/lib/x-express/labels";
import { fulfillmentPaymentReadiness } from "@/lib/payments/fulfillment-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const batch = await db.pickupBatch.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      provider: true,
      labelsCreatedAt: true,
      lines: {
        orderBy: [{ orderId: "asc" }, { packageNo: "asc" }],
        select: {
          orderId: true,
          orderItemId: true,
          reclamationId: true,
          purpose: true,
          lineGroupKey: true,
          packageNo: true,
          orderItem: { select: { name: true } },
        },
      },
    },
  });
  if (!batch) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!batch.lines.length) {
    return labelConflict("Nalog nema pakete za štampu.");
  }
  if (batch.provider !== MYGLS_PROVIDER && batch.provider !== X_EXPRESS_PROVIDER) {
    return labelConflict("Kurirska služba nije podešena na nalogu.", batch.id);
  }
  if (!batch.labelsCreatedAt) {
    return labelConflict(
      "Adresnice još nisu kreirane. Vratite se na nalog i kliknite „Kreiraj adresnice i pošalji“.",
      batch.id,
    );
  }

  const orderIds = [
    ...new Set(
      batch.lines
        .filter((line) => line.purpose === "ORDER_DELIVERY")
        .map((line) => line.orderId),
    ),
  ];
  if (orderIds.length) {
    const orders = await db.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        number: true,
        paymentMethod: true,
        payments: { select: { status: true } },
      },
    });
    const blocked = orders.filter(
      (order) =>
        !fulfillmentPaymentReadiness({
          purpose: "ORDER_DELIVERY",
          paymentMethod: order.paymentMethod,
          paymentStatuses: order.payments.map((payment) => payment.status),
        }).ready,
    );
    if (blocked.length) {
      return labelConflict(
        `Adresnice nisu dostupne jer plaćanje nije potvrđeno za: ${blocked
          .map((order) => order.number)
          .join(", ")}.`,
        batch.id,
      );
    }
  }
  const reclamationIds = batch.lines
    .map((line) => line.reclamationId)
    .filter((value): value is string => Boolean(value));
  const shipmentRows = await db.shipment.findMany({
    where: {
      provider: batch.provider,
      AND: [
        batch.provider === MYGLS_PROVIDER
          ? {
              AND: [
                usableMyGlsLabelWhere(),
                { labelObjectKey: { not: null } },
              ],
            }
          : {
              status: { not: "FAILED" },
              trackingNo: { not: null },
            },
        {
          OR: [
            { orderId: { in: orderIds }, purpose: "ORDER_DELIVERY" },
            ...(reclamationIds.length
              ? [
                  {
                    reclamationId: { in: reclamationIds },
                    purpose: "RECLAMATION_REPLACEMENT" as const,
                  },
                ]
              : []),
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
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

  const shipments = batch.lines.reduce<typeof shipmentRows>((selected, line) => {
    const shipment = shipmentRows.find((candidate) =>
      shipmentMatchesLine(candidate, line),
    );
    if (!shipment || selected.some((candidate) => candidate.id === shipment.id)) {
      return selected;
    }
    return [...selected, shipment];
  }, []);
  const missingGroups = [
    ...new Set(
      batch.lines
        .filter(
          (line) =>
            !shipmentRows.some((shipment) =>
              shipmentMatchesLine(shipment, line),
            ),
        )
        .map((line) => line.lineGroupKey),
    ),
  ];
  if (missingGroups.length) {
    return labelConflict(
      `Nedostaju kurirske adresnice za ${missingGroups.length} picking grupa. Ponovite kreiranje adresnica sa naloga.`,
      batch.id,
    );
  }
  const labelCount = shipments.reduce(
    (sum, shipment) => sum + Math.max(1, shipment.packageCount),
    0,
  );
  if (labelCount < batch.lines.length) {
    return labelConflict(
      `Pronađeno je ${labelCount} od ${batch.lines.length} potrebnih kurirskih adresnica. Ponovite kreiranje sa naloga.`,
      batch.id,
    );
  }

  if (batch.provider === MYGLS_PROVIDER) {
    const sourcePdfs = await Promise.all(
      shipments.map((shipment) =>
        downloadMyGlsLabelPdf(shipment.labelObjectKey!),
      ),
    );
    const pdf = await mergePdfDocuments(sourcePdfs, {
      title: `${batch.number} — kurirske etikete`,
      author: "Svet povoljnih cena",
    });
    return new NextResponse(pdf, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${batch.number}-kurirske-etikete.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-courier-label-source": "mygls-provider-pdfs-merged",
        "x-courier-label-count": String(labelCount),
      },
    });
  }

  const packageContentsByShipmentId = Object.fromEntries(
    shipments.map((shipment) => {
      const contents = batch.lines
        .filter((line) => shipmentMatchesLine(shipment, line))
        .sort((left, right) => left.packageNo - right.packageNo)
        .map((line) => line.orderItem?.name?.trim() || "Roba");
      return [shipment.id, contents];
    }),
  );
  let html: string;
  try {
    html = renderXExpressBatchLabelsHtml(shipments, {
      title: batch.number,
      autoPrint: true,
      packageContentsByShipmentId,
    });
  } catch (error) {
    return labelConflict(
      error instanceof Error
        ? error.message
        : "X Express adresnice nisu ispravne za štampu.",
      batch.id,
    );
  }
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `inline; filename="${batch.number}-kurirske-etikete.html"`,
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-courier-label-source": "x-express-api-data-batch",
      "x-courier-label-count": String(labelCount),
    },
  });
}

function shipmentMatchesLine(
  shipment: {
    orderId: string;
    reclamationId: string | null;
    purpose: ShipmentPurpose;
    rawCreateResponse: Prisma.JsonValue | null;
  },
  line: {
    orderId: string;
    orderItemId: string | null;
    reclamationId: string | null;
    purpose: ShipmentPurpose;
  },
) {
  if (line.purpose === "RECLAMATION_REPLACEMENT") {
    return (
      shipment.purpose === "RECLAMATION_REPLACEMENT" &&
      shipment.reclamationId === line.reclamationId
    );
  }
  const assignment = readShipmentAssignment(shipment.rawCreateResponse);
  return (
    shipment.purpose === "ORDER_DELIVERY" &&
    shipment.orderId === line.orderId &&
    (assignment == null ||
      Boolean(
        line.orderItemId &&
          assignment.orderItemIds.includes(line.orderItemId),
      ))
  );
}

function labelConflict(message: string, batchId?: string) {
  const returnHref = batchId
    ? `/admin/erp/preuzimanja/${encodeURIComponent(batchId)}`
    : "/admin/erp/preuzimanja";
  const html = `<!doctype html>
<html lang="sr-Latn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kurirske adresnice nisu spremne</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f2ec; color: #1f1b16; font-family: system-ui, sans-serif; padding: 24px; }
    main { width: min(560px, 100%); border: 1px solid #d7cec2; border-radius: 16px; background: #fff; padding: 28px; box-shadow: 0 16px 48px rgba(47, 38, 27, .08); }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { margin: 0; line-height: 1.6; color: #5f5549; }
    a { display: inline-flex; margin-top: 22px; border-radius: 9px; background: #6f4e37; color: #fff; padding: 10px 14px; font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <h1>Kurirske adresnice nisu spremne</h1>
    <p>${escapeHtml(message)}</p>
    <a href="${returnHref}">Vrati se na nalog</a>
  </main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 409,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
