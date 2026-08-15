import { describe, expect, it } from "vitest";
import { warehouseArchiveBlocker } from "@/lib/admin/warehouse-archive";

const ready = {
  name: "Izdvojeni magacin",
  isDefault: false,
  hasStock: false,
  hasOrderReservations: false,
  hasPartnerReservations: false,
  hasIncomingDocuments: false,
  hasOpenDispatches: false,
  hasOpenStockCounts: false,
};

describe("warehouse archive policy", () => {
  it("allows an empty non-default warehouse to be archived", () => {
    expect(warehouseArchiveBlocker(ready)).toBeNull();
  });

  it.each([
    ["isDefault", "podrazumevani magacin"],
    ["hasStock", "fizičko stanje"],
    ["hasOrderReservations", "aktivne rezervacije"],
    ["hasPartnerReservations", "aktivne rezervacije"],
    ["hasIncomingDocuments", "otvorenu nabavnu porudžbenicu ili prijemnicu"],
    ["hasOpenDispatches", "otvorenoj otpremnici"],
    ["hasOpenStockCounts", "otvoren popis"],
  ] as const)("blocks archive when %s is present", (key, message) => {
    expect(
      warehouseArchiveBlocker({ ...ready, [key]: true }),
    ).toContain(message);
  });
});
