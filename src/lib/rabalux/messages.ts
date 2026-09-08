export type SupplierMessageItem = {
  externalSku: string;
  qty: number;
  name?: string;
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
    .map(
      (item) =>
        `${item.externalSku}${item.name ? ` | ${item.name}` : ""} × ${item.qty}`,
    )
    .join("\n");
  const tableRows = input.items
    .map(
      (item) =>
        `<tr><td style="padding:6px;border:1px solid #ddd">${html(
          item.externalSku,
        )}</td><td style="padding:6px;border:1px solid #ddd">${html(
          item.name ?? "",
        )}</td><td style="padding:6px;border:1px solid #ddd">${item.qty}</td></tr>`,
    )
    .join("");
  return {
    subject: `Porudžbina ${input.orderNumber} – priprema artikala`,
    html: `<p>Poštovani,</p><p>molimo vas da pripremite sledeće artikle za porudžbinu <strong>${html(
      input.orderNumber,
    )}</strong>:</p><table style="border-collapse:collapse"><thead><tr><th style="padding:6px;border:1px solid #ddd">Rabalux šifra</th><th style="padding:6px;border:1px solid #ddd">Naziv artikla</th><th style="padding:6px;border:1px solid #ddd">Količina</th></tr></thead><tbody>${tableRows}</tbody></table><p>Molimo vas da potvrdite dostupnost svih stavki i mesto preuzimanja.</p><p>Srdačan pozdrav,<br/>Svet povoljnih cena</p>`,
    text: `Poštovani,\n\nmolimo vas da pripremite sledeće artikle za porudžbinu ${input.orderNumber}:\n\n${lines}\n\nMolimo vas da potvrdite dostupnost svih stavki i mesto preuzimanja.\n\nSrdačan pozdrav,\nSvet povoljnih cena`,
  };
}

export function supplierShippingDocumentsMessage(input: {
  orderNumber: string;
  trackingNo?: string | null;
  items: SupplierMessageItem[];
}) {
  const lines = input.items
    .map((item) => `${item.externalSku}${item.name ? ` – ${item.name}` : ""}, ${item.qty} kom.`)
    .join("\n");
  const paragraphs = [
    "Poštovani,",
    `U prilogu šaljemo svu dokumentaciju za porudžbinu ${input.orderNumber} na jednom mestu: adresnicu za štampu, pak-listu, Rabalux primerak predračuna i obrazac za odustajanje.`,
    `Artikli za porudžbinu:\n${lines}`,
    ...(input.trackingNo?.trim() ? [`Broj pošiljke: ${input.trackingNo.trim()}.`] : []),
    "Molimo vas da odštampate adresnicu, zalepite je na paket i predate paket kuriru.",
    "Srdačan pozdrav,\nSvet povoljnih cena",
  ];
  return {
    subject: `Porudžbina ${input.orderNumber} – kompletna dokumentacija i adresnica`,
    html: paragraphs.map((paragraph) => `<p>${html(paragraph).replace(/\n/g, "<br/>")}</p>`).join(""),
    text: paragraphs.join("\n\n"),
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
