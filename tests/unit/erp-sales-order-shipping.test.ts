import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { salesOrderShippingRow } from "@/lib/admin/erp-operations";

describe("sales-order shipping overview row", () => {
  it("shows a charged delivery as its own service line", () => {
    const row = salesOrderShippingRow({
      orderId: "order-1",
      common: { number: "SPC-2026-000171", channel: "WEB" },
      shipping: new Prisma.Decimal("590.00"),
    });

    expect(row).toMatchObject({
      id: "order-1",
      detailId: "order-1",
      cellHrefs: {
        number: "/admin/erp/prodajni-nalozi/order-1",
      },
      values: {
        number: "SPC-2026-000171",
        channel: "WEB",
        sku: "DOSTAVA",
        category: "Usluga",
        shortDescription: "Naplaćena isporuka",
        shortName: "Dostava",
        qty: 1,
        unitPrice: 590,
        totalNet: 491.67,
        totalGross: 590,
      },
    });
  });

  it.each([0, -1, null, undefined])(
    "does not add a service line for an uncharged delivery (%s)",
    (shipping) => {
      expect(
        salesOrderShippingRow({
          orderId: "order-1",
          common: {},
          shipping,
        }),
      ).toBeNull();
    },
  );
});
