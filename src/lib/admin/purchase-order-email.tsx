import "server-only";

import { renderEmail } from "@/lib/email/render";
import { PurchaseOrderSupplierEmail } from "@/lib/email/templates/purchase-order";
import {
  PURCHASE_ORDER_EMAIL_BODY,
  purchaseOrderEmailSubject,
} from "@/lib/admin/purchase-order";

export function purchaseOrderAttachmentFilename(number: string) {
  return `porudzbenica-${number.replaceAll("/", "-")}.pdf`;
}

export async function renderPurchaseOrderSupplierEmail(number: string) {
  const attachmentFilename = purchaseOrderAttachmentFilename(number);
  const rendered = await renderEmail(
    <PurchaseOrderSupplierEmail
      number={number}
      attachmentFilename={attachmentFilename}
    />,
  );

  return {
    subject: purchaseOrderEmailSubject(number),
    html: rendered.html,
    text: PURCHASE_ORDER_EMAIL_BODY,
    attachmentFilename,
  };
}
