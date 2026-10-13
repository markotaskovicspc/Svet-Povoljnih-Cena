import type { DispatchNotePrintData } from "@/lib/admin/dispatch-note-print.server";
export function dispatchNoteFixture(overrides: Partial<DispatchNotePrintData> = {}) {
  return {
    number: "13/10/2026-1", type: "CUSTOMER", issueDate: new Date("2026-10-13T10:00:00Z"),
    issuerName: "Svet povoljnih cena doo", issuerPib: "115085587", issuerRegistrationNumber: "22112597",
    issuerAddress: "Jurija Gagarina 32", issuerCity: "Beograd", issuerPostalCode: "11070",
    receiverName: "Ananas Ecommerce", receiverPib: "112195997", receiverRegistrationNumber: "21625434",
    receiverAddress: "Vladimira Popovića 8a", receiverCity: "Novi Beograd", receiverPostalCode: "11070",
    sourceWarehouse: { code: "DC", name: "Distributivni centar" }, destinationWarehouse: null,
    shipmentMethod: 2, carrierName: "Prevoznik", licensePlate: "BG 123 AB", showPrices: false,
    currency: "RSD", totalNet: 140000, totalVat: 28000, totalGross: 168000, notes: null,
    items: [{ sku: "110082", name: "Kancelarijska stolica FLEX SEAT", shortName: null, qty: 140,
      unitPriceGross: 1200, totalGross: 168000, product: { barcode: "8605079400014" } }],
    ...overrides,
  } as unknown as DispatchNotePrintData;
}
