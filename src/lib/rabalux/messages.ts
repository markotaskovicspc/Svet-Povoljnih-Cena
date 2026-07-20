export type SupplierMessageItem = {
  externalSku: string;
  qty: number;
};

function html(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function supplierOrderMessage(input: {
  orderNumber: string;
  items: SupplierMessageItem[];
}) {
  const lines = input.items
    .map((item) => `${item.externalSku} × ${item.qty}`)
    .join("\n");
  const tableRows = input.items
    .map(
      (item) =>
        `<tr><td style="padding:6px;border:1px solid #ddd">${html(
          item.externalSku,
        )}</td><td style="padding:6px;border:1px solid #ddd">${item.qty}</td></tr>`,
    )
    .join("");
  return {
    subject: `Porudžbina ${input.orderNumber}`,
    html: `<p>Poštovani,</p><p>molimo vas da pripremite sledeće artikle za porudžbinu <strong>${html(
      input.orderNumber,
    )}</strong>:</p><table style="border-collapse:collapse"><thead><tr><th style="padding:6px;border:1px solid #ddd">Rabalux šifra</th><th style="padding:6px;border:1px solid #ddd">Količina</th></tr></thead><tbody>${tableRows}</tbody></table><p>Molimo potvrdite dostupnost i mesto preuzimanja.</p>`,
    text: `Porudžbina ${input.orderNumber}\n\n${lines}\n\nMolimo potvrdite dostupnost i mesto preuzimanja.`,
  };
}

export function supplierCancellationMessage(input: {
  orderNumber: string;
  items: SupplierMessageItem[];
}) {
  const lines = input.items
    .map((item) => `${item.externalSku} × ${item.qty}`)
    .join("\n");
  return {
    subject: `Otkazivanje porudžbine ${input.orderNumber}`,
    html: `<p>Poštovani,</p><p>porudžbina <strong>${html(
      input.orderNumber,
    )}</strong> je otkazana. Molimo obustavite pripremu artikala.</p><pre>${html(
      lines,
    )}</pre>`,
    text: `Porudžbina ${input.orderNumber} je otkazana.\n\n${lines}`,
  };
}

export function supplierOrderIdempotencyKey(
  fulfillmentId: string,
  dispatchKey = "initial",
) {
  return `supplier-order:${fulfillmentId}:${dispatchKey}`;
}

export function supplierCancellationIdempotencyKey(fulfillmentId: string) {
  return `supplier-cancel:${fulfillmentId}`;
}
