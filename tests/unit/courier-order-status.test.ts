import { describe, expect, it } from "vitest";
import { orderStatusForDeliveryShipments } from "@/lib/courier/status";

describe("order status for split courier shipments", () => {
  it("keeps a split order in delivery until every shipment is delivered", () => {
    expect(
      orderStatusForDeliveryShipments({
        eventStatus: "DELIVERED",
        currentOrderStatus: "U_ISPORUCI",
        deliveryShipmentStatuses: ["DELIVERED", "IN_TRANSIT"],
      }),
    ).toBeNull();
  });

  it("marks the order delivered after the last shipment is delivered", () => {
    expect(
      orderStatusForDeliveryShipments({
        eventStatus: "DELIVERED",
        currentOrderStatus: "U_ISPORUCI",
        deliveryShipmentStatuses: ["DELIVERED", "DELIVERED"],
      }),
    ).toBe("ISPORUCENO");
  });

  it("does not regress an in-transit order when the other courier reports pickup", () => {
    expect(
      orderStatusForDeliveryShipments({
        eventStatus: "PICKED_UP",
        currentOrderStatus: "U_ISPORUCI",
        deliveryShipmentStatuses: ["IN_TRANSIT", "PICKED_UP"],
      }),
    ).toBeNull();
  });

  it("does not reopen a terminal cancelled order", () => {
    expect(
      orderStatusForDeliveryShipments({
        eventStatus: "IN_TRANSIT",
        currentOrderStatus: "OTKAZANO",
        deliveryShipmentStatuses: ["IN_TRANSIT"],
      }),
    ).toBeNull();
  });
});
