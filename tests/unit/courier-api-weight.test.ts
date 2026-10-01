import { expect, it } from "vitest";
import { courierApiWeightKg } from "@/lib/courier/api-weight";

it("converts provider weights with gram precision and never emits zero", () => {
  expect([10, 3.5, 1.234, 0.001].map(courierApiWeightKg)).toEqual([8, 2.8, 0.987, 0.001]);
  for (const invalid of [0, -1, NaN, Infinity]) expect(() => courierApiWeightKg(invalid)).toThrow();
});
