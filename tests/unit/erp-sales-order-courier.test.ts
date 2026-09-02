import { describe, expect, it } from "vitest";
import {
  salesOrderCourierDisplay,
  salesOrderOperationalStatus,
} from "@/lib/admin/erp-operations";
import { getErpModuleDefinition } from "@/lib/admin/erp";

describe("sales-order courier overview display", () => {
  it("uses one operational status with the agreed business precedence", () => {
    expect(
      salesOrderOperationalStatus({
        orderStatus: "OTKAZANO",
        paymentStatuses: ["REFUNDED", "PARTIAL_REFUND"],
        courierStatus: "Isporučeno",
      }),
    ).toBe("Refundirano");
    expect(
      salesOrderOperationalStatus({
        orderStatus: "OTKAZANO",
        paymentStatuses: ["PARTIAL_REFUND"],
        courierStatus: "Isporučeno",
      }),
    ).toBe("Otkazano");
    expect(
      salesOrderOperationalStatus({
        orderStatus: "U_OBRADI",
        paymentStatuses: ["PARTIAL_REFUND"],
        courierStatus: "U tranzitu",
      }),
    ).toBe("Delimično refundirano");
    expect(
      salesOrderOperationalStatus({
        orderStatus: "U_OBRADI",
        paymentStatuses: ["PAID"],
        courierStatus: "U tranzitu",
      }),
    ).toBe("U tranzitu");
  });

  it("defines every agreed operational status tone explicitly", () => {
    const definition = getErpModuleDefinition("prodajni-nalozi");
    const columns = definition?.columns ?? [];
    expect(columns.some((column) => column.key === "status")).toBe(false);
    const tones = columns.find((column) => column.key === "courierStatus")
      ?.statusToneByValue;

    expect(tones).toMatchObject({
      "Nalog nije kreiran": "blue",
      "Pošiljka kreirana": "blue",
      "Preuzeto iz magacina": "yellow",
      "U tranzitu": "yellow",
      "Na isporuci": "yellow",
      Isporučeno: "green",
      Otkazano: "red",
      "Neuspešna isporuka": "red",
      Refundirano: "purple",
      "Delimično refundirano": "purple",
      Vraćeno: "purple",
    });
  });

  it("shows the courier status assigned to the matching order item", () => {
    expect(
      salesOrderCourierDisplay({
        shippingMethod: "KURIR",
        itemId: "line-a",
        shipments: [
          shipment({
            provider: "MYGLS",
            status: "OUT_FOR_DELIVERY",
            itemIds: ["line-a"],
          }),
          shipment({
            provider: "X_EXPRESS",
            status: "DELIVERED",
            itemIds: ["line-b"],
          }),
        ],
      }),
    ).toEqual({ service: "MyGLS", status: "Na isporuci" });
  });

  it("uses the latest shipment when a courier assignment was replaced", () => {
    expect(
      salesOrderCourierDisplay({
        shippingMethod: "KURIR",
        itemId: "line-a",
        shipments: [
          shipment({
            provider: "X_EXPRESS",
            status: "FAILED",
            itemIds: ["line-a"],
            updatedAt: "2026-08-28T10:00:00.000Z",
          }),
          shipment({
            provider: "MYGLS",
            status: "PICKED_UP",
            itemIds: ["line-a"],
            updatedAt: "2026-08-28T10:01:00.000Z",
          }),
        ],
      }),
    ).toEqual({ service: "MyGLS", status: "Preuzeto iz magacina" });
  });

  it("shows a genuine provider failure and distinguishes local cancellation", () => {
    expect(
      salesOrderCourierDisplay({
        shippingMethod: "KURIR",
        itemId: "line-a",
        shipments: [shipment({ status: "FAILED", itemIds: ["line-a"] })],
      }),
    ).toEqual({ service: "X Express", status: "Neuspešna isporuka" });
    expect(
      salesOrderCourierDisplay({
        shippingMethod: "KURIR",
        itemId: "line-a",
        shipments: [
          shipment({
            status: "FAILED",
            itemIds: ["line-a"],
            providerStatusCode: "ADDRESS_REPLACED",
          }),
        ],
      }),
    ).toEqual({ service: "X Express", status: "Kurirski nalog otkazan" });
  });

  it("supports legacy whole-order assignments and orders without a shipment", () => {
    expect(
      salesOrderCourierDisplay({
        shippingMethod: "KURIR",
        itemId: "legacy-line",
        shipments: [shipment({ status: "IN_TRANSIT", itemIds: null })],
      }),
    ).toEqual({ service: "X Express", status: "U tranzitu" });
    expect(
      salesOrderCourierDisplay({
        shippingMethod: "KURIR",
        itemId: "line-a",
        shipments: [],
      }),
    ).toEqual({
      service: "Kurirski nalog nije kreiran",
      status: "Nalog nije kreiran",
    });
  });
});

function shipment(overrides: {
  provider?: string;
  status:
    | "CREATED"
    | "PICKED_UP"
    | "IN_TRANSIT"
    | "OUT_FOR_DELIVERY"
    | "DELIVERED"
    | "RETURNED"
    | "FAILED";
  itemIds: string[] | null;
  providerStatusCode?: string;
  updatedAt?: string;
}) {
  return {
    provider: overrides.provider ?? "X_EXPRESS",
    status: overrides.status,
    providerStatusCode: overrides.providerStatusCode ?? null,
    updatedAt: overrides.updatedAt ?? "2026-08-28T10:00:00.000Z",
    rawCreateResponse: overrides.itemIds
      ? { assignment: { orderItemIds: overrides.itemIds, codAmount: 0 } }
      : null,
  };
}
