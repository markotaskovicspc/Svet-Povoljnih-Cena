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
  waitingForPayment?: boolean;
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
    subject: `${input.waitingForPayment ? "Rezervacija" : "Porudžbina"} ${input.orderNumber}`,
    html: `<p>Poštovani,</p>${
      input.waitingForPayment
        ? "<p><strong>REZERVACIJA — NE SLATI.</strong> Čeka se potvrda uplate kupca. Adresnicu i dokument za pakovanje poslaćemo tek kada uplata bude potvrđena.</p>"
        : ""
    }<p>molimo vas da pripremite sledeće artikle za porudžbinu <strong>${html(
      input.orderNumber,
    )}</strong>:</p><table style="border-collapse:collapse"><thead><tr><th style="padding:6px;border:1px solid #ddd">Rabalux šifra</th><th style="padding:6px;border:1px solid #ddd">Količina</th></tr></thead><tbody>${tableRows}</tbody></table>`,
    text: `${input.waitingForPayment ? "REZERVACIJA — NE SLATI. Čeka se potvrda uplate kupca. Adresnica i dokument za pakovanje stižu nakon potvrde uplate.\n\n" : ""}Porudžbina ${input.orderNumber}\n\n${lines}`,
  };
}

export function supplierShippingDocumentsMessage(input: {
  orderNumber: string;
  trackingNo?: string | null;
  items: SupplierMessageItem[];
}) {
  const lines = input.items
    .map((item) => `${item.externalSku} × ${item.qty}`)
    .join("\n");
  const tracking = input.trackingNo?.trim()
    ? `<p>Broj pošiljke: <strong>${html(input.trackingNo)}</strong></p>`
    : "";
  return {
    subject: `Spremno za slanje ${input.orderNumber}`,
    html: `<p>Poštovani,</p><p>porudžbina <strong>${html(input.orderNumber)}</strong> je spremna za slanje.</p>${tracking}<p>U prilogu su adresnica i dokument za pakovanje samo za Rabalux artikle. Odštampajte adresnicu, zalepite je na paket i predajte paket kuriru.</p><pre>${html(lines)}</pre><p>Dokumenti namerno ne sadrže prodajne cene.</p>`,
    text: `Porudžbina ${input.orderNumber} je spremna za slanje.${input.trackingNo ? `\nBroj pošiljke: ${input.trackingNo}` : ""}\n\nU prilogu su adresnica i dokument za pakovanje samo za Rabalux artikle. Dokumenti ne sadrže prodajne cene.\n\n${lines}`,
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

export function supplierShippingDocumentsIdempotencyKey(
  fulfillmentId: string,
  dispatchKey = "initial",
) {
  return `supplier-shipping-documents:${fulfillmentId}:${dispatchKey}`;
}
