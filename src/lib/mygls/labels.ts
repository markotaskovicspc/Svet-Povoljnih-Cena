import "server-only";

import type { Prisma } from "@prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyGlsConfig, MyGlsConfigError } from "./config";
import { redactMyGlsSenderContactPdf } from "./label-redaction";
import { MYGLS_RECOVERABLE_STATUS_CODES } from "./status";
import { addMyGlsProductBarcodes, MyGlsProductBarcodeLayoutError } from "./product-barcode";
import { enlargeMyGlsArticleText, MyGlsPrintLayoutError } from "./print-layout";

/**
 * A provider PDF remains printable when a status-sync mapping failed, as long
 * as the PDF exists and the row has no real provider/deletion error.
 */
export function usableMyGlsLabelWhere(): Prisma.ShipmentWhereInput {
  return {
    OR: [
      { status: { not: "FAILED" } },
      {
        status: "FAILED",
        providerStatusCode: {
          in: [...MYGLS_RECOVERABLE_STATUS_CODES],
        },
        labelObjectKey: { not: null },
        syncError: null,
      },
    ],
  };
}

export function adminShipmentLabelPath(shipmentId: string) {
  return `/api/admin/shipments/${encodeURIComponent(shipmentId)}/label`;
}

export async function uploadMyGlsLabelPdf(args: {
  shipmentId: string;
  orderNumber: string;
  bytes: Buffer;
}) {
  if (!args.bytes.length) {
    throw new MyGlsConfigError("MyGLS nije vratio PDF etiketu.");
  }

  const cfg = getMyGlsConfig();
  const objectKey = `mygls/${sanitize(args.orderNumber)}/${args.shipmentId}.pdf`;
  const label = await redactMyGlsSenderContactPdf(args.bytes);
  const client = createAdminClient();
  const { error } = await client.storage
    .from(cfg.labelBucket)
    .upload(objectKey, label.bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) {
    throw new MyGlsConfigError(`Upload MyGLS etikete nije uspeo: ${error.message}`);
  }
  return {
    objectKey,
    mimeType: "application/pdf",
    labelUrl: adminShipmentLabelPath(args.shipmentId),
    bytes: label.bytes,
  };
}

export async function downloadMyGlsLabelPdf(objectKey: string) {
  const cfg = getMyGlsConfig();
  const client = createAdminClient();
  const { data, error } = await client.storage.from(cfg.labelBucket).download(objectKey);
  if (error || !data) {
    throw new MyGlsConfigError(error?.message ?? "MyGLS etiketa nije pronađena.");
  }
  const label = await redactMyGlsSenderContactPdf(await data.arrayBuffer());
  let printable = label.bytes;
  try {
    printable = await enlargeMyGlsArticleText(printable);
  } catch (error) {
    if (!(error instanceof MyGlsPrintLayoutError)) throw error;
    console.warn("[mygls-label] Article enlargement omitted: unsupported label layout.");
  }
  try {
    return (await addMyGlsProductBarcodes(printable)).bytes;
  } catch (error) {
    if (!(error instanceof MyGlsProductBarcodeLayoutError)) throw error;
    // The article barcode is optional; the provider's original tracking barcode
    // remains usable. Never block a paid/created shipment on this decoration,
    // and never return the unredacted PDF or a partially barcoded document.
    console.warn("[mygls-label] Article barcode omitted: unsupported label layout.");
    return printable;
  }
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
