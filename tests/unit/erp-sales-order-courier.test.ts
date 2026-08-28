import { describe, expect, it } from "vitest";
import { salesOrderCourierServiceLabel } from "@/lib/admin/erp-operations";

describe("sales-order courier overview label", () => {
  it("shows the active courier provider", () => {
    expect(
      salesOrderCourierServiceLabel({
        shippingMethod: "KURIR",
        providers: ["MYGLS"],
      }),
    ).toBe("MyGLS");
  });

  it("shows each provider once when an order has multiple active shipments", () => {
    expect(
      salesOrderCourierServiceLabel({
        shippingMethod: "KURIR",
        providers: ["X_EXPRESS", "MYGLS", "X_EXPRESS"],
      }),
    ).toBe("MyGLS / X Express");
  });

  it("distinguishes missing courier orders from non-courier delivery", () => {
    expect(
      salesOrderCourierServiceLabel({
        shippingMethod: "KURIR",
        providers: [],
      }),
    ).toBe("Kurirski nalog nije kreiran");
    expect(
      salesOrderCourierServiceLabel({
        shippingMethod: "KAMION",
        providers: [],
      }),
    ).toBe("Nije kurirska isporuka");
  });
});
