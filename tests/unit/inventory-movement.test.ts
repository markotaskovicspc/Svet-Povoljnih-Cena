import { StockMovementKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  STOCK_MOVEMENT_KIND_LABELS,
  stockMovementKindLabel,
} from "@/lib/inventory-movement";

describe("inventory movement labels", () => {
  it("defines a user-facing type for every persisted movement kind", () => {
    expect(Object.keys(STOCK_MOVEMENT_KIND_LABELS).sort()).toEqual(
      Object.values(StockMovementKind).sort(),
    );
  });

  it("uses the client-requested business wording", () => {
    expect(stockMovementKindLabel(StockMovementKind.PURCHASE_RECEIPT)).toBe(
      "Prijem robe",
    );
    expect(stockMovementKindLabel(StockMovementKind.DISPATCH)).toBe(
      "Eksterna otpremnica",
    );
    expect(stockMovementKindLabel(StockMovementKind.STOCK_COUNT)).toBe(
      "Manjak / višak po popisu",
    );
    expect(stockMovementKindLabel(StockMovementKind.SALE_RESERVATION)).toBe(
      "Fiskalizacija / prodaja",
    );
  });
});
