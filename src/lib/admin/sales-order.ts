import { z } from "zod";

export const SUPPLIER_ALLOCATION = "SUPPLIER";
export const SALES_VAT_RATE = 20;
export const DECIMAL_12_2_MAX = 9_999_999_999.99;

export const MANUAL_SALES_ORDER_STATUSES = [
  "KREIRANO",
  "POTVRDJENO",
  "U_PRIPREMI",
  "SPREMNO_ZA_ISPORUKU",
] as const;

const manualSalesOrderLineSchema = z.object({
  sku: z.string().trim().min(1, "Šifra artikla je obavezna.").max(120),
  qty: z.coerce
    .number()
    .int("Količina mora biti ceo broj.")
    .min(1, "Količina mora biti najmanje 1.")
    .max(999_999, "Količina je prevelika."),
  unitPrice: z.coerce
    .number()
    .finite("MP cena mora biti broj.")
    .min(0, "MP cena ne može biti negativna.")
    .max(999_999_999.99, "MP cena je prevelika."),
  allocation: z.string().trim().min(1, "Magacin je obavezan."),
});

export const manualSalesOrderInputSchema = z
  .object({
    channel: z.enum(["MP", "VP", "INO"]),
    customerId: z.string().trim().min(1, "Kupac je obavezan."),
    priceListId: z.string().trim().min(1, "Cenovnik je obavezan."),
    status: z.enum(MANUAL_SALES_ORDER_STATUSES).default("KREIRANO"),
    paid: z.boolean().default(false),
    sefAccepted: z.boolean().default(false),
    lines: z
      .array(manualSalesOrderLineSchema)
      .min(1, "Porudžbina mora imati najmanje jedan artikal.")
      .max(200, "Jedna porudžbina može imati najviše 200 šifara."),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    let orderGross = 0;
    value.lines.forEach((line, index) => {
      const normalized = line.sku.toLocaleUpperCase("sr-Latn-RS");
      if (seen.has(normalized)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "sku"],
          message: "Svaka šifra može da postoji samo u jednom redu.",
        });
      }
      seen.add(normalized);
      const lineGross = roundSalesMoney(line.qty * line.unitPrice);
      orderGross = roundSalesMoney(orderGross + lineGross);
      if (lineGross > DECIMAL_12_2_MAX) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "unitPrice"],
          message: "Ukupna vrednost reda premašuje kapacitet baze.",
        });
      }
    });
    if (orderGross > DECIMAL_12_2_MAX) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Ukupna vrednost porudžbine premašuje kapacitet baze.",
      });
    }
  });

export type ManualSalesOrderInput = z.infer<typeof manualSalesOrderInputSchema>;

export type WarehouseSuggestion =
  | { type: "WAREHOUSE"; warehouseId: string }
  | { type: "SUPPLIER" }
  | null;

export function resolveSalesOrderWarehouse(input: {
  articleStatus: string;
  dcAvailableQty: number;
  defaultWarehouseId: string | null;
}): WarehouseSuggestion {
  if (input.articleStatus === "DOB" && input.dcAvailableQty <= 0) {
    return { type: "SUPPLIER" };
  }
  if (!input.defaultWarehouseId) return null;
  return { type: "WAREHOUSE", warehouseId: input.defaultWarehouseId };
}

export function roundSalesMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateSalesLineTotals(
  qty: number,
  unitPriceGross: number,
  vatRate = SALES_VAT_RATE,
) {
  const totalGross = roundSalesMoney(qty * unitPriceGross);
  const totalNet = roundSalesMoney(totalGross / (1 + vatRate / 100));
  return {
    totalNet,
    totalGross,
    totalVat: roundSalesMoney(totalGross - totalNet),
  };
}

export function manualOrderNumberPrefix(channel: "MP" | "VP" | "INO") {
  return channel;
}
