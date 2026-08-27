import "server-only";

import { db } from "@/lib/db";
import type { EmailAttachment } from "@/lib/email";
import { buildPdf } from "@/lib/email/pdf";
import { downloadMyGlsLabelPdf, MYGLS_PROVIDER } from "@/lib/mygls";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import { renderXExpressLabelsHtml } from "@/lib/x-express/labels";

export function buildRabaluxPackingPdf(input: {
  orderNumber: string;
  items: Array<{ externalSku: string; qty: number; name: string }>;
}) {
  return buildPdf(`Dokument za pakovanje ${input.orderNumber}`, [
    { text: "Dobavljac: Rabalux", bold: true },
    { text: "Ovaj dokument ne sadrzi prodajne cene." },
    { text: "" },
    { text: "Rabalux sifra | Artikal | Kolicina", bold: true },
    ...input.items.map((item) => ({
      text: `${item.externalSku} | ${item.name} | ${item.qty}`,
    })),
    { text: "" },
    { text: "U paket staviti samo gore navedene Rabalux artikle." },
  ]);
}

export async function buildRabaluxShipmentAttachments(args: {
  shipmentId: string;
  orderNumber: string;
  packingPdf: Buffer;
}): Promise<EmailAttachment[]> {
  const shipment = await db.shipment.findUnique({
    where: { id: args.shipmentId },
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
  if (!shipment) throw new Error("Kurirska pošiljka nije pronađena.");

  const packing: EmailAttachment = {
    filename: `pak-lista-${safe(args.orderNumber)}.pdf`,
    content: args.packingPdf.toString("base64"),
    contentType: "application/pdf",
  };
  if (shipment.provider === MYGLS_PROVIDER && shipment.labelObjectKey) {
    const label = await downloadMyGlsLabelPdf(shipment.labelObjectKey);
    return [
      {
        filename: `adresnica-${safe(args.orderNumber)}.pdf`,
        content: label.toString("base64"),
        contentType: shipment.labelMimeType ?? "application/pdf",
      },
      packing,
    ];
  }
  if (shipment.provider === X_EXPRESS_PROVIDER) {
    const label = renderXExpressLabelsHtml(shipment);
    return [
      {
        filename: `adresnica-${safe(args.orderNumber)}.html`,
        content: Buffer.from(label, "utf8").toString("base64"),
        contentType: "text/html; charset=utf-8",
      },
      packing,
    ];
  }
  throw new Error("Adresnica za izabranog kurira nije dostupna.");
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
