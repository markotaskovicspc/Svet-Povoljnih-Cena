const codes = ["KAP0000289404", "AAA0650159625"];
function paths(value: unknown, prefix = "", result = new Set<string>(), depth = 0): Set<string> {
  if (depth > 5 || result.size > 500) return result;
  if (Array.isArray(value)) {
    for (const row of value.slice(0, 25)) paths(row, `${prefix}[]`, result, depth + 1);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      result.add(path);
      paths(child, path, result, depth + 1);
    }
  }
  return result;
}

function barcode(value: unknown): string | string[] | null {
  if (Array.isArray(value)) return value.slice(0, 100).flatMap(v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(v) ? [v] : []);
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(value) ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;
}

export function summarize(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Unexpected provider response");
  const data = payload as Record<string, unknown>;
  const rows = Array.isArray(data.content) ? data.content : [];
  const fieldPaths = [...paths(rows)].sort();
  return {
    count: rows.length, totalElements: typeof data.totalElements === "number" ? data.totalElements : null, last: data.last === true,
    fieldPaths,
    logisticsFields: fieldPaths.filter(path => /track|parcel|barcode|return|package|label|consign|waybill/i.test(path)),
    codePresentInResponse: Object.fromEntries(codes.map(code => [code, JSON.stringify(payload).includes(code)])),
    matches: rows.filter(row => codes.some(code => JSON.stringify(row).includes(code))).map(row => {
      const r = row as Record<string, unknown>;
      return { orderId: r.orderId, suborderId: r.suborderId, status: r.status, carrierName: r.carrierName, shipmentBarcode: barcode(r.shipmentBarcode), shipmentParcelBarcodes: barcode(r.shipmentParcelBarcodes) };
    }),
    barcodePopulated: rows.filter(row => row && typeof row === "object" && (barcode((row as Record<string, unknown>).shipmentBarcode) || (barcode((row as Record<string, unknown>).shipmentParcelBarcodes) as string[] | null)?.length)).length,
    sample: rows.slice(0, 3).map(row => {
      const r = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return { ...Object.fromEntries(["orderId", "suborderId", "status", "carrierName"].map(key => [key, typeof r[key] === "string" || typeof r[key] === "number" ? r[key] : null])), shipmentBarcode: barcode(r.shipmentBarcode), shipmentParcelBarcodes: barcode(r.shipmentParcelBarcodes) };
    }),
  };
}

