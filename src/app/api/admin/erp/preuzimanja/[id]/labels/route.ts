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
      lines: {
        orderBy: [{ orderId: "asc" }, { packageNo: "asc" }],
        select: {
          orderId: true,
          orderItemId: true,
          reclamationId: true,
          purpose: true,
          lineGroupKey: true,
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
    return labelConflict("Kurirska služba nije podešena na nalogu.");
  }

  const orderIds = [...new Set(batch.lines.map((line) => line.orderId))];
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
              providerShipmentId: { not: null },
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
      `Nedostaju kurirske etikete za ${missingGroups.length} picking grupa.`,
    );
  }
  const labelCount = shipments.reduce(
    (sum, shipment) => sum + Math.max(1, shipment.packageCount),
    0,
  );
  if (labelCount < batch.lines.length) {
    return labelConflict(
      `Pronađeno je ${labelCount} od ${batch.lines.length} potrebnih kurirskih etiketa.`,
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

  const html = renderXExpressBatchLabelsHtml(shipments, {
    title: batch.number,
    autoPrint: true,
  });
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

function labelConflict(message: string) {
  return NextResponse.json(
    { ok: false, error: "courier_labels_unavailable", message },
    { status: 409 },
  );
}
