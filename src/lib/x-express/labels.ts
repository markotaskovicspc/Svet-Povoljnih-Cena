import "server-only";

import { Prisma, type PaymentMethod } from "@prisma/client";
import { num } from "@/lib/api/_helpers";
import { formatDateTime, formatRsd } from "@/lib/format";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

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

type XExpressLabelShipment = {
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
    shipPhone: string;
    shipStreet: string;
    shipCity: string;
    shipPostalCode: string;
    notes: string | null;
    items: Array<{ name: string; qty: number }>;
  };
};

export function renderXExpressLabelsHtml(shipment: XExpressLabelShipment) {
  const trackingCodes = readTrackingCodes(shipment);
  const count = Math.max(1, shipment.packageCount || trackingCodes.length || 1);
  const codes = Array.from({ length: count }, (_, index) => {
    return trackingCodes[index] ?? trackingCodes[0] ?? shipment.trackingNo ?? shipment.order.number;
  });

  return `<!doctype html>
<html lang="sr-Latn">
<head>
  <meta charset="utf-8" />
  <title>X Express etikete ${escapeHtml(shipment.order.number)}</title>
  <style>
    @page { size: A4; margin: 9mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f5f5; color: #000; font-family: Arial, Helvetica, sans-serif; }
    .sheet { display: grid; grid-template-columns: repeat(2, 95mm); grid-auto-rows: 138mm; gap: 6mm 5mm; align-items: start; justify-content: center; padding: 0; }
    .label { width: 95mm; height: 138mm; overflow: hidden; background: white; padding: 4mm 5mm 3mm; page-break-inside: avoid; display: flex; flex-direction: column; }
    .topline { text-align: center; font-size: 7px; line-height: 1.1; font-weight: 700; margin-bottom: 1.5mm; }
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
    .stamp { margin-top: auto; text-align: center; font-size: 8px; line-height: 1; font-weight: 700; }
    @media print { body { background: white; } .sheet { gap: 0; grid-template-columns: repeat(2, 95mm); grid-auto-rows: 138mm; } .label { break-inside: avoid; } }
  </style>
</head>
<body>
  <main class="sheet">
    ${codes.map((code, index) => renderLabel(shipment, code, index + 1, count)).join("")}
  </main>
</body>
</html>`;
}

function renderLabel(
  shipment: XExpressLabelShipment,
  trackingCode: string,
  index: number,
  count: number,
) {
  const order = shipment.order;
  const cod = isCod(order.paymentMethod);
  const route = shipment.providerRouteCode ?? shipment.providerRouteName ?? "REON";
  const packageData = readPackageData(shipment.rawCreateResponse, trackingCode);
  const content =
    packageData?.content ??
    (order.items
      .map((item) => item.name)
      .filter(Boolean)
      .slice(0, 2)
      .join(", ")
      .slice(0, 80) || "Roba");
  const note = truncateLabelText(order.notes?.trim() || "", 120);
  return `<section class="label">
    <div class="topline">X EXPRESS DOO BEOGRAD · Đorđa Ognjanovića 16, Beograd · 011 443 44 44</div>
    <div class="sender"><strong>Pošiljalac:</strong><br />${escapeHtml(MERCHANT_LEGAL_INFO.name)}<br />${escapeHtml(MERCHANT_LEGAL_INFO.shortAddress)}<br />${escapeHtml(MERCHANT_LEGAL_INFO.phone ?? MERCHANT_LEGAL_INFO.email)}</div>
    <div class="barcode">${code128Svg(trackingCode)}</div>
    <div class="code">${escapeHtml(trackingCode)}</div>
    <div class="recipient">Primalac:<strong>${escapeHtml(`${order.shipFirstName} ${order.shipLastName}`.trim())},<br />${escapeHtml(order.shipStreet)}<br />${escapeHtml(`${order.shipPostalCode} ${order.shipCity}`)}<br />${escapeHtml(order.shipPhone)}</strong></div>
    <div class="route"><span class="route-code">${escapeHtml(route)}</span><span class="pkg">${index}/${count}</span></div>
    <div class="meta">
      <div><strong>Referenca:</strong> ${escapeHtml(shipment.id)}<br /><strong>Porudžbina:</strong> ${escapeHtml(order.number)}<br /><strong>Sadržaj:</strong> ${escapeHtml(content)}</div>
      <div><strong>Uslugu plaća:</strong> nalogodavac - virman<br /><strong>Otkupnina:</strong> ${cod ? escapeHtml(formatRsd(num(order.total))) : "0 RSD"}<br /><strong>Masa:</strong> ${escapeHtml(formatMass(packageData?.mass))}</div>
    </div>
    <div class="note"><strong>Napomena:</strong><br />${escapeHtml(note)}</div>
    <div class="stamp">vreme štampe: ${escapeHtml(formatDateTime(new Date()))}</div>
  </section>`;
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
