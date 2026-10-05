import { describe, expect, it } from "vitest";
import { canonicalPickupStreet, pickupAddressLabel, samePickupStreet } from "@/lib/address/pickup-street-aliases";

describe("town-scoped pickup street aliases", () => {
  it("uses the confirmed name only in Senta and keeps the customer's house number", () => {
    expect(pickupAddressLabel({ shipStreet: "Berta Istvan (59)", shipHouseNumber: "59", shipCity: "Senta" })).toBe("Ištvana Berte (59)");
    expect(canonicalPickupStreet("Berta Istvan", "Beograd")).toBe("Berta Istvan");
    expect(samePickupStreet("Иштвана Берта", "Berta Istvan", "Сента")).toBe(true);
  });
  it("does not equate different Cyrillic streets by dropping their letters", () => {
    expect(samePickupStreet("Прва", "Друга", "Senta")).toBe(false);
    expect(samePickupStreet("Прва", "Прва", "Senta")).toBe(true);
  });
});
