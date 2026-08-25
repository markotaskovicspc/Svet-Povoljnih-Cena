import "server-only";

import { Prisma, type PaymentMethod } from "@prisma/client";
import { num } from "@/lib/api/_helpers";
import { formatDateTime, formatRsd } from "@/lib/format";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import type { XExpressCreateOrderPayload } from "./types";

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
] as const;

export type XExpressLabelShipment = {
  id: string;
  trackingNo: string | null;
  packageCount: number;
  providerParcelNumbers: Prisma.JsonValue | null;
  providerRouteCode: string | null;
  providerRouteName: string | null;
  rawCreateResponse: Prisma.JsonValue | null;
  createdAt: Date;
  order: {
    number: string;
    total: Prisma.Decimal | number | bigint;
    paymentMethod: PaymentMethod;
    shipFirstName: string;
    shipLastName: string;
    shipCompanyName?: string | null;
    shipPhone: string;
    shipStreet: string;
    shipCity: string;
    shipPostalCode: string;
    notes: string | null;
    items: Array<{ name: string; qty: number }>;
  };
};

export type XExpressLabelData = {
  version: 1;
  source: "X_EXPRESS_API_PAYLOAD";
  reference: string;
  sender: {
    name: string;
    contactName: string;
    phone: string;
    streetName: string;
    streetNumber: string;
    city: string;
    postalCode: string;
  };
  recipient: {
    name: string;
    phone: string;
    streetName: string;
    streetNumber: string;
    city: string;
    postalCode: string;
  };
  content: string;
  servicePayerId: number;
  serviceTypeId: number;
  codAmount: number;
};

export function buildXExpressLabelData(args: {
  payload: XExpressCreateOrderPayload;
  pickupTown?: { name: string; displayName?: string | null; postalCode?: string | null } | null;
  deliveryCity: string;
  deliveryPostalCode: string;
}): XExpressLabelData {
  const pickup = args.payload.Waypoints.find((waypoint) => waypoint.WaypointType === "PICKUP");
  const delivery = args.payload.Waypoints.find((waypoint) => waypoint.WaypointType === "DELIVERY");
  if (!pickup || !delivery) {
    throw new Error("X Express API zahtev nema pickup i delivery podatke za etiketu.");
  }
  const codAmount = args.payload.Options?.find((option) => option.OptionTypeId === 2)?.Data.Amount ?? 0;
  return {
    version: 1,
    source: "X_EXPRESS_API_PAYLOAD",
    reference: args.payload.Reference,
    sender: {
      name: args.payload.Sender.Name,
      contactName: pickup.Contact.Name,
      phone: pickup.Contact.Phone,
      streetName: pickup.Address.StreetName,
      streetNumber: pickup.Address.StreetNumber,
      city: args.pickupTown?.displayName || args.pickupTown?.name || `Mesto ${pickup.Address.TownId}`,
      postalCode: args.pickupTown?.postalCode || "",
    },
    recipient: {
      name: args.payload.Recipient.Name,
      phone: args.payload.Recipient.Phone,
      streetName: delivery.Address.StreetName,
      streetNumber: delivery.Address.StreetNumber,
      city: args.deliveryCity,
      postalCode: args.deliveryPostalCode,
    },
    content: args.payload.Content,
    servicePayerId: args.payload.ServicePayerId,
    serviceTypeId: args.payload.TypeId,
    codAmount,
  };
}

export function renderXExpressLabelsHtml(shipment: XExpressLabelShipment) {
  return renderXExpressBatchLabelsHtml([shipment], {
    title: shipment.order.number,
  });
}

export function renderXExpressBatchLabelsHtml(
  shipments: readonly XExpressLabelShipment[],
  options: { title?: string; autoPrint?: boolean } = {},
) {
  if (!shipments.length) {
    throw new Error("Nema X Express etiketa za štampu.");
  }
  const title = options.title ?? shipments.map((shipment) => shipment.order.number).join(", ");
  const labels = shipments.flatMap(renderShipmentLabels);

  return `<!doctype html>
<html lang="sr-Latn">
<head>
  <meta charset="utf-8" />
  <title>X Express etikete ${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 9mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f5f5; color: #000; font-family: Arial, Helvetica, sans-serif; }
    .screen-note { max-width: 195mm; margin: 5mm auto; border: 1px solid #111; background: #fff; padding: 3mm; font-size: 12px; line-height: 1.35; }
    .sheet { display: grid; grid-template-columns: repeat(2, 95mm); grid-auto-rows: 138mm; gap: 6mm 5mm; align-items: start; justify-content: center; padding: 0; }
    .label { width: 95mm; height: 138mm; overflow: hidden; background: white; padding: 4mm 5mm 3mm; page-break-inside: avoid; display: flex; flex-direction: column; }
    .topline { border: 1.5px solid #000; padding: 1.2mm; text-align: center; font-size: 8px; line-height: 1.1; font-weight: 800; margin-bottom: 1.5mm; letter-spacing: .04em; }
    .sender { border: 1px solid #ddd; padding: 1.5mm; min-height: 14mm; font-size: 8px; line-height: 1.08; overflow-wrap: anywhere; }
    .barcode { margin: 2mm 0 1mm; text-align: center; }
    .barcode svg { width: 100%; height: 21mm; display: block; }
    .code { text-align: center; font-size: 20px; line-height: 1; font-weight: 800; letter-spacing: 0; }
    .recipient { border: 1px solid #ddd; min-height: 32mm; margin-top: 2mm; padding: 2mm; font-size: 16px; line-height: 1.1; overflow-wrap: anywhere; }
    .recipient strong { display: block; font-size: 18px; line-height: 1.1; }
    .route { display: flex; align-items: baseline; justify-content: space-between; gap: 3mm; margin-top: 2mm; }
    .route-code { font-size: 30px; line-height: 1; font-weight: 900; }
    .pkg { font-size: 28px; line-height: 1; font-weight: 900; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 2.5mm; font-size: 9px; line-height: 1.2; overflow-wrap: anywhere; }
    .note { margin-top: 2mm; font-size: 8.5px; line-height: 1.15; white-space: pre-wrap; }
    .stamp { margin-top: auto; display: flex; justify-content: space-between; gap: 2mm; border-top: 1px solid #000; padding-top: 1.2mm; font-size: 7px; line-height: 1.1; font-weight: 700; }
    @media print { body { background: white; } .screen-note { display: none; } .sheet { gap: 0; grid-template-columns: repeat(2, 95mm); grid-auto-rows: 138mm; } .label { break-inside: avoid; } }
  </style>
</head>
<body>
  <aside class="screen-note"><strong>X Express ne vraća PDF adresnicu kroz API.</strong> Ove transportne etikete generiše ERP isključivo iz podataka koje je X Express prihvatio pri kreiranju naloga. Ne menjajte podatke ručno posle kreiranja pošiljke.</aside>
  <main class="sheet">
    ${labels.join("")}
  </main>
  ${options.autoPrint ? "<script>window.addEventListener('load', () => window.print());</script>" : ""}
</body>
</html>`;
}

function renderShipmentLabels(shipment: XExpressLabelShipment) {
  const trackingCodes = readTrackingCodes(shipment);
  const count = Math.max(1, shipment.packageCount || trackingCodes.length || 1);
  const codes = Array.from({ length: count }, (_, index) => {
    return trackingCodes[index] ?? trackingCodes[0] ?? shipment.trackingNo ?? shipment.order.number;
  });
  return codes.map((code, index) => renderLabel(shipment, code, index + 1, count));
}

function renderLabel(
  shipment: XExpressLabelShipment,
  trackingCode: string,
  index: number,
  count: number,
) {
  const order = shipment.order;
  const labelData = readLabelData(shipment.rawCreateResponse);
  const recipientName =
    labelData?.recipient.name ||
    order.shipCompanyName ||
    `${order.shipFirstName} ${order.shipLastName}`.trim();
  const cod = isCod(order.paymentMethod);
  const route = shipment.providerRouteCode ?? shipment.providerRouteName ?? "REON";
  const packageData = readPackageData(shipment.rawCreateResponse, trackingCode);
  const content =
    packageData?.content ??
    labelData?.content ??
    (order.items
      .map((item) => item.name)
      .filter(Boolean)
      .slice(0, 2)
      .join(", ")
      .slice(0, 80) || "Roba");
  const note = truncateLabelText(order.notes?.trim() || "", 120);
  const sender = labelData?.sender;
  const recipient = labelData?.recipient;
  const senderAddress = sender
    ? `${sender.streetName} ${sender.streetNumber}, ${joinPostalCity(sender.postalCode, sender.city)}`
    : MERCHANT_LEGAL_INFO.shortAddress;
  const recipientAddress = recipient
    ? `${recipient.streetName} ${recipient.streetNumber}`
    : order.shipStreet;
  const recipientPostalCity = recipient
    ? joinPostalCity(recipient.postalCode, recipient.city)
    : `${order.shipPostalCode} ${order.shipCity}`;
  const codAmount = labelData?.codAmount ?? (cod ? num(order.total) : 0);
  const reference = labelData?.reference ?? shipment.id;
  const payer = labelData ? `ID ${labelData.servicePayerId}` : "nalogodavac";
  const serviceType = labelData ? `ID ${labelData.serviceTypeId}` : "—";
  return `<section class="label">
    <div class="topline">X EXPRESS · ERP TRANSPORTNA ETIKETA</div>
    <div class="sender"><strong>Pošiljalac:</strong><br />${escapeHtml(sender?.name ?? MERCHANT_LEGAL_INFO.name)}<br />${escapeHtml(senderAddress)}<br />Kontakt: ${escapeHtml(sender?.contactName ?? MERCHANT_LEGAL_INFO.name)} · ${escapeHtml(sender?.phone ?? MERCHANT_LEGAL_INFO.phone ?? MERCHANT_LEGAL_INFO.email)}</div>
    <div class="barcode">${code128Svg(trackingCode)}</div>
    <div class="code">${escapeHtml(trackingCode)}</div>
    <div class="recipient">Primalac:<strong>${escapeHtml(recipientName)}<br />${escapeHtml(recipientAddress)}<br />${escapeHtml(recipientPostalCity)}<br />${escapeHtml(recipient?.phone ?? order.shipPhone)}</strong></div>
    <div class="route"><span class="route-code">${escapeHtml(route)}</span><span class="pkg">${index}/${count}</span></div>
    <div class="meta">
      <div><strong>API referenca:</strong> ${escapeHtml(reference)}<br /><strong>Porudžbina:</strong> ${escapeHtml(order.number)}<br /><strong>Sadržaj:</strong> ${escapeHtml(content)}</div>
      <div><strong>Uslugu plaća:</strong> ${escapeHtml(payer)}<br /><strong>Vrsta usluge:</strong> ${escapeHtml(serviceType)}<br /><strong>Otkupnina:</strong> ${escapeHtml(formatRsd(codAmount))}<br /><strong>Masa:</strong> ${escapeHtml(formatMass(packageData?.mass))}</div>
    </div>
    <div class="note"><strong>Napomena:</strong><br />${escapeHtml(note)}</div>
    <div class="stamp"><span>Izvor: X Express API podaci</span><span>štampa: ${escapeHtml(formatDateTime(new Date()))}</span></div>
  </section>`;
}

function readLabelData(raw: Prisma.JsonValue | null): XExpressLabelData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw.labelData;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sender = value.sender;
  const recipient = value.recipient;
  if (
    value.version !== 1 ||
    value.source !== "X_EXPRESS_API_PAYLOAD" ||
    typeof value.reference !== "string" ||
    !isLabelParty(sender, true) ||
    !isLabelParty(recipient, false) ||
    typeof value.content !== "string" ||
    typeof value.servicePayerId !== "number" ||
    typeof value.serviceTypeId !== "number" ||
    typeof value.codAmount !== "number"
  ) {
    return null;
  }
  return value as XExpressLabelData;
}

function isLabelParty(value: unknown, sender: boolean) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const required = ["name", "phone", "streetName", "streetNumber", "city", "postalCode"];
  if (sender) required.push("contactName");
  return required.every((key) => typeof record[key] === "string");
}

function joinPostalCity(postalCode: string, city: string) {
  return [postalCode.trim(), city.trim()].filter(Boolean).join(" ");
}

function readTrackingCodes(shipment: XExpressLabelShipment) {
  const raw = shipment.providerParcelNumbers;
  const values = Array.isArray(raw) ? raw : [];
  const codes = values
    .map((value) => (typeof value === "string" || typeof value === "number" ? String(value) : ""))
    .filter(Boolean);
  return [...new Set([...(shipment.trackingNo ? [shipment.trackingNo] : []), ...codes])];
}

function isCod(method: PaymentMethod) {
  return method === "POUZECE_GOTOVINA" || method === "POUZECE_KARTICA";
}

function code128Svg(value: string) {
  const codes = encodeXExpressCode128(value);
  const checksum = codes.reduce((sum, code, index) => sum + (index === 0 ? code : code * index), 0) % 103;
  const allCodes = [...codes, checksum, 106];
  const modules = allCodes.flatMap((code) => CODE128_PATTERNS[code].split("").map(Number));
  const width = modules.reduce((sum, module) => sum + module, 0);
  let x = 0;
  let bar = true;
  const rects: string[] = [];
  for (const moduleWidth of modules) {
    if (bar) rects.push(`<rect x="${x}" y="0" width="${moduleWidth}" height="60" />`);
    x += moduleWidth;
    bar = !bar;
  }
  return `<svg viewBox="0 0 ${width} 60" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(value)} barcode">${rects.join("")}</svg>`;
}

export function encodeXExpressCode128(value: string) {
  const chars = String(value);
  const codes = [103];
  let mode: "A" | "B" | "C" = "A";
  let i = 0;
  while (i < chars.length) {
    const digitRun = chars.slice(i).match(/^\d+/)?.[0] ?? "";
    if (digitRun.length >= 4) {
      if (mode !== "C") {
        codes.push(99);
        mode = "C";
      }
      const usable = digitRun.length % 2 === 0 ? digitRun.length : digitRun.length - 1;
      for (let j = 0; j < usable; j += 2) {
        codes.push(Number(digitRun.slice(j, j + 2)));
      }
      i += usable;
      continue;
    }
    const charCode = chars.charCodeAt(i);
    if (mode === "C") {
      codes.push(100);
      mode = "B";
    }
    if (mode === "A" && charCode > 95) {
      codes.push(100);
      mode = "B";
    }
    if (charCode < 32 || charCode > 127) {
      throw new Error(`Code128 ne podržava karakter u bar-kodu: ${chars[i]}`);
    }
    codes.push(charCode - 32);
    i += 1;
  }
  return codes;
}

function readPackageData(raw: Prisma.JsonValue | null, trackingCode: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const packages = raw.packages;
  if (!Array.isArray(packages)) return null;
  for (const entry of packages) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const code = typeof entry.Code === "string" ? entry.Code : "";
    if (code !== trackingCode) continue;
    return {
      mass: typeof entry.Mass === "number" ? entry.Mass : null,
      content: typeof entry.Content === "string" ? entry.Content : null,
    };
  }
  return null;
}

function formatMass(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("sr-Latn-RS", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value)} kg`;
}

function truncateLabelText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
