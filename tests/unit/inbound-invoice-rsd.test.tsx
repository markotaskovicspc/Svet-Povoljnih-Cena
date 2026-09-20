import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InboundInvoiceCogsTable } from "@/components/admin/inbound-invoice-cogs-table";
import { allocateActualInboundCosts, reconcileInboundGoods } from "@/lib/admin/inbound-invoice";

const lines = [[5.66, 120], [7.64, 90], [9, 100], [11.5, 200], [16.5, 200], [31, 200], [49, 25], [68, 25]]
  .map(([purchasePrice, qty], index) => ({
    id: `line-${index}`, sku: `TEST-${index}`, qty, purchasePrice,
    purchaseValueRsd: purchasePrice * qty, totalVolumeM3: index + 1,
    customsRatePct: index === 0 ? null : index === 1 ? 0 : 10,
  }));
const costs = { invoiceValueRsd: 1_717_177, customsValueRsd: 42_439, transportValueRsd: 393_345, otherRelatedCostsRsd: 29_555 };

describe("RSD receipts with foreign purchase prices", () => {
  it.each(["USD", "EUR"] as const)("allocates the exact RSD goods and costs for %s prices, matching booking", orderCurrency => {
    const reconciliation = reconcileInboundGoods({ invoiceCurrency: "RSD", orderCurrency, invoiceValue: costs.invoiceValueRsd, invoiceValueRsd: costs.invoiceValueRsd, lines });
    expect(reconciliation.error).toBeNull();
    expect(reconciliation.orderValue).toBe(16_991.8);
    expect(reconciliation.exchangeRate).toBeCloseTo(1_717_177 / 16_991.8, 8);
    const rows = allocateActualInboundCosts({ costs, lines, otherCostsBasis: "VOLUME", goodsValuesRsd: reconciliation.lineValuesRsd! });
    const booking = allocateActualInboundCosts({ costs, lines, otherCostsBasis: "VOLUME" });
    expect(rows).toEqual(booking);
    for (const [key, expected] of Object.entries({ invoiceValueRsd: 1_717_177, customsRsd: 42_439, transportRsd: 393_345, otherRelatedCostsRsd: 29_555, totalActualCostRsd: 2_182_516 })) {
      expect(rows.reduce((sum, row) => sum + Number(row[key as keyof typeof row]), 0)).toBeCloseTo(expected, 2);
    }
    const html = renderToStaticMarkup(createElement(InboundInvoiceCogsTable, { purchaseCurrency: orderCurrency, rows: rows.map((row, index) => ({ ...row,
      name: `Artikal ${index}`, purchasePrices: [lines[index].purchasePrice], customsRates: [lines[index].customsRatePct],
      existingQty: 0, existingCogs: 0, finalCogs: row.incomingUnitCogsRsd,
    })) }));
    for (const label of ["Carinska stopa", "Stvarna carina", "Transport po zapremini", "Ostali vezani troškovi", "Postojeće stanje / COGS", "Finalni COGS", "Nije uneta", "0,00 %", "10,00 %", "1.717.177,00 RSD", "42.439,00 RSD"]) expect(html).toContain(label);
    for (const line of lines) expect(html).toContain(line.sku);
    expect(html).toContain('role="alert"');
    expect(html).toContain(`Nabavna cena (${orderCurrency})`);
  });

  it("does not fabricate allocations from missing prices or a missing RSD amount", () => {
    const input = { invoiceCurrency: "RSD" as const, orderCurrency: "USD" as const, invoiceValue: 100, invoiceValueRsd: 100, lines: [{ qty: 1, purchasePrice: 0 }] };
    expect(reconcileInboundGoods(input).lineValuesRsd).toBeNull();
    expect(reconcileInboundGoods({ ...input, invoiceValue: 0, invoiceValueRsd: 0, lines: [{ qty: 1, purchasePrice: 5 }] }).lineValuesRsd).toBeNull();
    expect(reconcileInboundGoods({ ...input, invoiceValue: 50 }).error).toContain("moraju biti iste");
  });
});
