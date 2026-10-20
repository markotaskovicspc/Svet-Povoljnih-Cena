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

export function summarize(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { shape: "unexpected" };
  const data = payload as Record<string, unknown>;
  const rows = Array.isArray(data.content) ? data.content : [];
  const fieldPaths = [...paths(rows)].sort();
  return {
    count: rows.length, totalElements: typeof data.totalElements === "number" ? data.totalElements : null, last: data.last === true,
    fieldPaths,
    logisticsFields: fieldPaths.filter(path => /track|parcel|barcode|return|package|label|consign|waybill/i.test(path)),
    codePresentInResponse: Object.fromEntries(codes.map(code => [code, JSON.stringify(payload).includes(code)])),
    sample: rows.slice(0, 3).map(row => {
      const r = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return Object.fromEntries(["orderId", "suborderId", "status", "carrierName"].map(key => [key, typeof r[key] === "string" || typeof r[key] === "number" ? r[key] : null]));
    }),
  };
}

