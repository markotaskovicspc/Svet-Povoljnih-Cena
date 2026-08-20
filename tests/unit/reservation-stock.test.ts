import { describe, expect, it } from "vitest";
import {
  reservationQuantityTotals,
  resolveFiscalReservationPosting,
  resolveStoredWarehouseBalance,
} from "@/lib/reservation-stock";

describe("reservation stock model", () => {
  it("keeps new reservations out of physical stock and removes them from availability", () => {
    expect(
      resolveStoredWarehouseBalance({
        storedQty: 100,
        orderReservations: [{ qty: 3, debited: false }],
      }),
    ).toMatchObject({ physical: 100, reserved: 3, available: 97 });
  });

  it("reconstructs legacy reservations that were already deducted", () => {
    expect(
      resolveStoredWarehouseBalance({
        storedQty: 97,
        orderReservations: [{ qty: 3, debited: true }],
      }),
    ).toMatchObject({ physical: 100, reserved: 3, available: 97 });
  });

  it("supports legacy, new and partner reservations at the same time", () => {
    expect(
      resolveStoredWarehouseBalance({
        storedQty: 97,
        orderReservations: [
          { qty: 3, debited: true },
          { qty: 4, debited: false },
        ],
        partnerReserved: 2,
      }),
    ).toMatchObject({ physical: 100, reserved: 9, available: 91 });
    expect(
      reservationQuantityTotals([
        { qty: 3, debited: true },
        { qty: 4, debited: false },
      ]),
    ).toEqual({ reserved: 7, debited: 3, pending: 4 });
  });

  it("fiscalizes a legacy debit even when its old order item has no warehouse reference", () => {
    expect(
      resolveFiscalReservationPosting({
        movementQtys: [-3],
        warehouseId: null,
      }),
    ).toEqual({ type: "already-debited" });
  });

  it("requires a warehouse before a new reservation can debit physical stock", () => {
    expect(() =>
      resolveFiscalReservationPosting({
        movementQtys: [],
        warehouseId: null,
      }),
    ).toThrow("DC rezervacija nema upisan magacin.");
    expect(
      resolveFiscalReservationPosting({
        movementQtys: [],
        warehouseId: "warehouse-dc",
      }),
    ).toEqual({ type: "debit", warehouseId: "warehouse-dc" });
  });
});
