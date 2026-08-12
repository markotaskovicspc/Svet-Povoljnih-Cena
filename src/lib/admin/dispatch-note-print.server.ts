import "server-only";

import { db } from "@/lib/db";
import { buildPdf } from "@/lib/email/pdf";
import { DISPATCH_SHIPMENT_METHODS } from "@/lib/admin/dispatch-note";

export async function getDispatchNotePrintData(id: string) {
  return db.dispatchNote.findUnique({
    where: { id },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      items: { orderBy: { id: "asc" } },
    },
  });
}

type PrintData = NonNullable<
  Awaited<ReturnType<typeof getDispatchNotePrintData>>
>;

function money(value: unknown, currency: string) {
  return `${Number(value).toLocaleString("sr-Latn-RS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function wrapText(value: string, max = 86) {
  const words = value.split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= max) {
      current = next;
    } else {
      if (current) result.push(current);
      current = word;
    }
  }
  if (current) result.push(current);
  return result.length ? result : [""];
}

export function buildDispatchNotePdf(note: PrintData) {
  const includePrices = note.type !== "INTERNAL" && note.showPrices;
  const lines: Array<{
    text: string;
    bold?: boolean;
    size?: number;
    spaceAbove?: number;
  }> = [
    {
      text: `Datum otpremnice: ${note.issueDate.toLocaleDateString("sr-Latn-RS")}`,
    },
    {
      text: `Vrsta: ${note.type === "INTERNAL" ? "Interni prenos" : "Otpremnica kupcu"}`,
    },
    { text: "" },
    { text: "Firma koja izdaje robu:", bold: true },
    { text: note.issuerName },
    {
      text: `PIB: ${note.issuerPib} | MB: ${note.issuerRegistrationNumber} | ${note.issuerAddress}, ${note.issuerPostalCode} ${note.issuerCity}`,
    },
    {
      text: `Magacin: ${note.sourceWarehouse.code} · ${note.sourceWarehouse.name}`,
    },
    { text: "" },
    { text: "Firma koja prima robu:", bold: true },
    { text: note.receiverName },
    {
      text: `PIB: ${note.receiverPib} | MB: ${note.receiverRegistrationNumber} | ${note.receiverAddress}, ${note.receiverPostalCode} ${note.receiverCity}`,
    },
  ];
  if (note.type === "INTERNAL" && note.destinationWarehouse) {
    lines.push({
      text: `Odredišni magacin: ${note.destinationWarehouse.code} · ${note.destinationWarehouse.name}`,
    });
  }
  const shipmentMethod = DISPATCH_SHIPMENT_METHODS.find(
    (method) => method.value === note.shipmentMethod,
  );
  lines.push({ text: "" }, { text: "Transport:", bold: true });
  lines.push({ text: shipmentMethod?.label ?? String(note.shipmentMethod) });
  if (note.shipmentMethod <= 3) {
    lines.push({ text: `Prevoznik: ${note.carrierName ?? "—"}` });
    lines.push({ text: `Registarska oznaka: ${note.licensePlate ?? "—"}` });
  } else {
    lines.push({
      text: `Kurir: ${[note.courierFirstName, note.courierLastName]
        .filter(Boolean)
        .join(" ")} | Lična karta: ${note.courierIdNumber ?? "—"}`,
    });
  }
  lines.push({ text: "" }, { text: "Stavke:", bold: true });
  note.items.forEach((item, index) => {
    const pallet = item.palletQty
      ? ` | komada na paleti ${item.palletQty}`
      : "";
    const base = `${index + 1}. ${item.sku} | ${item.shortName ?? item.name} | količina ${item.qty}${pallet}`;
    const priced = includePrices
      ? ` | cena ${money(item.unitPriceGross, note.currency)} | ukupno ${money(item.totalGross, note.currency)}`
      : "";
    for (const [lineIndex, text] of wrapText(`${base}${priced}`).entries()) {
      lines.push({
        text,
        bold: lineIndex === 0,
        spaceAbove: lineIndex === 0 ? 3 : 0,
      });
    }
    const metadata = [
      item.subgroup ? `Podgrupa: ${item.subgroup}` : "",
      item.collection ? `Kolekcija: ${item.collection}` : "",
      item.shortDescription ? `Opis: ${item.shortDescription}` : "",
      [item.attribute1, item.attribute2, item.attribute3, item.attribute4]
        .filter(Boolean)
        .length
        ? `Atributi: ${[
            item.attribute1,
            item.attribute2,
            item.attribute3,
            item.attribute4,
          ]
            .filter(Boolean)
            .join(" / ")}`
        : "",
      [item.color1, item.color2].filter(Boolean).length
        ? `Boje: ${[item.color1, item.color2].filter(Boolean).join(" / ")}`
        : "",
      item.sourceOrderNumber
        ? `Porudžbina: ${item.sourceOrderNumber}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");
    for (const text of wrapText(metadata)) {
      lines.push({ text: `   ${text}`, size: 9 });
    }
  });
  if (includePrices) {
    lines.push(
      { text: "" },
      {
        text: `Vrednost bez PDV-a: ${money(note.totalNet, note.currency)}`,
      },
      { text: `PDV: ${money(note.totalVat, note.currency)}` },
      {
        text: `Vrednost sa PDV-om: ${money(note.totalGross, note.currency)}`,
        bold: true,
        size: 13,
      },
    );
  } else {
    lines.push(
      { text: "" },
      {
        text:
          note.type === "INTERNAL"
            ? "Interni prenos — cene se ne prikazuju."
            : "Cene nisu prikazane na štampi ove otpremnice.",
        bold: true,
      },
    );
  }
  if (note.notes) {
    lines.push({ text: "" });
    for (const text of wrapText(`Napomena: ${note.notes}`)) {
      lines.push({ text });
    }
  }
  return buildPdf(`Otpremnica ${note.number}`, lines);
}
