import { config as loadEnv } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { geocodePickupAddress } from "@/lib/address/google-geocoding";

// Explicit opt-in only. Uses public addresses, never creates courier orders.
// GOOGLE_GEOCODING_LIVE_TEST=1 npx vitest run tests/unit/google-geocoding-live.test.ts
describe.skipIf(process.env.GOOGLE_GEOCODING_LIVE_TEST !== "1")("Google Geocoding live acceptance", () => {
  beforeAll(() => { loadEnv({ path: ".env.local", quiet: true }); });
  it.each([
    { shipStreet: "Trg republike (1)", shipHouseNumber: "1", shipCity: "Beograd (Stari grad)" },
    { shipStreet: "Bulevar Mihajla Pupina 1", shipCity: "Novi Sad" },
    { shipStreet: "Трг републике 1", shipCity: "Београд" },
  ])("resolves a Serbian building: $shipCity / $shipStreet", async (address) => {
    const point = await geocodePickupAddress(address);
    expect(point.latitude).toBeGreaterThan(41.8);
    expect(point.longitude).toBeGreaterThan(18.8);
  }, 15_000);
  it("does not accept an invented house number", async () => {
    await expect(geocodePickupAddress({ shipStreet: "Trg republike 99999", shipCity: "Beograd" })).rejects.toThrow(/nije pouzdano/);
  }, 15_000);
});
