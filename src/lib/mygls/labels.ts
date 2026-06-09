import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getMyGlsConfig, MyGlsConfigError } from "./config";

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
  const client = createAdminClient();
  const { error } = await client.storage
    .from(cfg.labelBucket)
    .upload(objectKey, args.bytes, {
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
  };
}

export async function downloadMyGlsLabelPdf(objectKey: string) {
  const cfg = getMyGlsConfig();
  const client = createAdminClient();
  const { data, error } = await client.storage.from(cfg.labelBucket).download(objectKey);
  if (error || !data) {
    throw new MyGlsConfigError(error?.message ?? "MyGLS etiketa nije pronađena.");
  }
  return Buffer.from(await data.arrayBuffer());
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
