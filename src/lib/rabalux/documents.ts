import "server-only";

import { db } from "@/lib/db";
import type { EmailAttachment } from "@/lib/email";
import {
  buildPdf,
  buildSupplierInvoicePdf,
  buildWithdrawalFormPdf,
  type InvoiceAddressInput,
  type WithdrawalOrderInput,
} from "@/lib/email/pdf";
import { downloadMyGlsLabelPdf, MYGLS_PROVIDER } from "@/lib/mygls";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import { renderXExpressLabelsHtml } from "@/lib/x-express/labels";
import { renderPrintHtmlPdf } from "@/lib/pdf/print-html";

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

export type RabaluxSupplierOrderDocumentInput = {
  orderNumber: string;
  createdAt: Date;
  items: Array<{ externalSku: string; qty: number; name: string }>;
  shippingAddress: InvoiceAddressInput;
  billingAddress?: InvoiceAddressInput | null;
};

export async function buildRabaluxSupplierOrderPdf(
  input: RabaluxSupplierOrderDocumentInput,
) {
  return buildSupplierInvoicePdf({
    number: input.orderNumber,
    createdAt: input.createdAt,
    items: input.items.map((item) => ({
      sku: item.externalSku,
      name: item.name,
      qty: item.qty,
    })),
    shipping_address: input.shippingAddress,
    billing_address: input.billingAddress,
  });
}

export async function buildRabaluxSupplierOrderAttachments(
  input: RabaluxSupplierOrderDocumentInput,
): Promise<EmailAttachment[]> {
  const withdrawalOrder = toWithdrawalOrder(input);
  const attachments: EmailAttachment[] = [
    {
      filename: `predracun-rabalux-${safe(input.orderNumber)}.pdf`,
      content: (await buildRabaluxSupplierOrderPdf(input)).toString("base64"),
      contentType: "application/pdf",
    },
    {
      filename: `obrazac-za-odustajanje-${safe(input.orderNumber)}.pdf`,
      content: buildWithdrawalFormPdf(withdrawalOrder).toString("base64"),
      contentType: "application/pdf",
    },
  ];
  assertRabaluxSupplierOrderAttachmentSet(attachments);
  return attachments;
}

export function assertRabaluxSupplierOrderAttachmentSet(
  attachments: readonly EmailAttachment[],
) {
  const expected = ["predracun-rabalux-", "obrazac-za-odustajanje-"];
  if (
    attachments.length !== expected.length ||
    !expected.every(
      (prefix) =>
        attachments.filter((attachment) =>
          attachment.filename.startsWith(prefix),
        ).length === 1,
    ) ||
    attachments.some(
      (attachment) =>
        !expected.some((prefix) => attachment.filename.startsWith(prefix)),
    )
  ) {
    throw new Error(
      "Rabalux porudzbina sme da sadrzi samo Rabalux primerak predracuna i obrazac za odustajanje.",
    );
  }
}

function toWithdrawalOrder(
  input: RabaluxSupplierOrderDocumentInput,
): WithdrawalOrderInput {
  return {
    number: input.orderNumber,
    createdAt: input.createdAt,
    items: input.items.map((item) => ({
      sku: item.externalSku,
      name: item.name,
    })),
    shipping_address: input.shippingAddress,
    billing_address: input.billingAddress,
  };
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
    const label = await renderPrintHtmlPdf(renderXExpressLabelsHtml(shipment));
    return [
      {
        filename: `adresnica-${safe(args.orderNumber)}.pdf`,
        content: label.toString("base64"),
        contentType: "application/pdf",
      },
      packing,
    ];
  }
  throw new Error("Adresnica za izabranog kurira nije dostupna.");
}

/** Defense in depth: a supplier dispatch may contain only its label and packing list. */
export function assertRabaluxSupplierAttachmentSet(
  attachments: readonly EmailAttachment[],
) {
  const labelCount = attachments.filter((attachment) =>
    attachment.filename.startsWith("adresnica-"),
  ).length;
  const packingCount = attachments.filter((attachment) =>
    attachment.filename.startsWith("pak-lista-"),
  ).length;
  const everyAttachmentAllowed = attachments.every(
    (attachment) =>
      attachment.filename.startsWith("adresnica-") ||
      attachment.filename.startsWith("pak-lista-"),
  );
  const everyAttachmentPdf = attachments.every(
    (attachment) =>
      attachment.filename.endsWith(".pdf") &&
      attachment.contentType === "application/pdf" &&
      Buffer.from(attachment.content, "base64").subarray(0, 5).toString("ascii") === "%PDF-",
  );
  if (
    attachments.length !== 2 ||
    labelCount !== 1 ||
    packingCount !== 1 ||
    !everyAttachmentAllowed ||
    !everyAttachmentPdf
  ) {
    throw new Error(
      "Rabalux dobavljaču se smeju poslati samo adresnica i packing lista u PDF formatu.",
    );
  }
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
